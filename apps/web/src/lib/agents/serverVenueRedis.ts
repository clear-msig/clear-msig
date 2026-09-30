import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { hashText } from "./serverVenueOrderContract";
import type {
  AgentVenueBridgePorts,
  DedicatedVenueBinding,
  ProtectedVenueReceipt,
  VenueDeliveryClaim,
} from "./serverVenueBridge";

export type VenueRedisCommand = (command: string[]) => Promise<unknown>;

/** Explicit server configuration only; never an in-memory fallback or browser credential. */
export function createVenueRedisCommand(
  url: string,
  token: string,
): VenueRedisCommand {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !token.trim()
  ) {
    throw new Error(
      "A trusted HTTPS Redis endpoint and server credential are required.",
    );
  }
  return async (command) => {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok || !response.body)
      throw new Error("Durable venue storage is unavailable.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 65_536) {
          await reader.cancel();
          throw new Error("Durable venue storage response exceeds its bound.");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const result = JSON.parse(bytes.toString("utf8")) as {
      result?: unknown;
      error?: unknown;
    };
    if (result.error || !("result" in result))
      throw new Error("Durable venue storage rejected the operation.");
    return result.result;
  };
}

// One venue-scoped hash keeps every atomic decision in one Redis cluster slot.
// Account isolation spans Solana deployments sharing this venue registry.
// Fields never expire. The backing database MUST have durable storage and no eviction.
// Lease expiry changes a delivery to uncertain, never back into a sendable state.
const LEDGER_SCRIPT = `
local db=KEYS[1]
local scope=table.remove(ARGV,1)
local op=ARGV[1]
local id=ARGV[2]
local ownerId=scope..':'..id
local field='delivery:'..ownerId
local raw=redis.call('HGET',db,field)
local r=raw and cjson.decode(raw) or nil
local clock=redis.call('TIME')
local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
local function save() redis.call('HSET',db,field,cjson.encode(r)) end
local function unlock()
 if redis.call('HGET',db,'account:'..r.account)==ownerId then redis.call('HDEL',db,'account:'..r.account) end
end
if op=='lookup' then
 if not r then return 'null' end
 if r.commitment~=ARGV[3] or r.account~=ARGV[4] then return redis.error_reply('Changed delivery commitment or account') end
 if r.state=='completed' then return cjson.encode({state='completed',receipt=r.receipt}) end
 if r.state=='blocked' then return 'null' end
 if r.state=='uncertain' or now>=r.expires then r.state='uncertain'; save(); return cjson.encode({state='uncertain'}) end
 return cjson.encode({state='in_flight'})
end
if op=='claim' then
 local commitment=ARGV[3]; local account=ARGV[4]; local lease=ARGV[5]; local duration=tonumber(ARGV[6])
 if r and (r.commitment~=commitment or r.account~=account) then return redis.error_reply('Changed delivery commitment or account') end
 if r and r.state=='completed' then return cjson.encode({state='completed',receipt=r.receipt}) end
 if r and r.state~='blocked' then
  if r.state=='uncertain' or now>=r.expires then r.state='uncertain'; save(); return cjson.encode({state='uncertain'}) end
  return cjson.encode({state='in_flight'})
 end
 local owner=redis.call('HGET',db,'account:'..account)
 if owner and owner~=ownerId then return cjson.encode({state='in_flight'}) end
 r={commitment=commitment,account=account,lease=lease,expires=now+duration,state='reserved'}
 save(); redis.call('HSET',db,'account:'..account,ownerId)
 return cjson.encode({state='acquired',leaseId=lease})
end
if not r then return redis.error_reply('Unknown delivery') end
if op=='complete' then
 local receipt=cjson.decode(ARGV[4])
 if receipt.deliveryKey~=id or receipt.commitment~=r.commitment or receipt.accountAddress~=r.account then return redis.error_reply('Receipt identity mismatch') end
 if r.state=='completed' then
  if r.receiptJson~=ARGV[4] then return redis.error_reply('Conflicting completion') end
  return 'ok'
 end
 if (ARGV[3]=='' and r.state~='uncertain') or (ARGV[3]~='' and ARGV[3]~=r.lease) or (r.state~='submitting' and r.state~='uncertain') then return redis.error_reply('Completion lacks submission authority') end
 r.state='completed'; r.receipt=receipt; r.receiptJson=ARGV[4]; save(); unlock(); return 'ok'
end
if ARGV[3]~=r.lease then return redis.error_reply('Stale delivery lease') end
if op=='begin' then
 if r.state~='reserved' or now>=r.expires or redis.call('HGET',db,'account:'..r.account)~=ownerId then return redis.error_reply('Submission lease unavailable') end
 r.state='submitting'; save(); return 'ok'
elseif op=='block' then
 if r.state~='reserved' then return redis.error_reply('Attempted delivery cannot be released') end
 r.state='blocked'; save(); unlock(); return 'ok'
elseif op=='uncertain' then
 if r.state=='completed' then return 'ok' end
 if r.state~='submitting' and r.state~='uncertain' then return redis.error_reply('No attempted delivery') end
 r.state='uncertain'; save(); return 'ok'
end
return redis.error_reply('Unknown ledger operation')
`;

const BINDING_SCRIPT = `
local db=KEYS[1]; local scope=table.remove(ARGV,1); local op=ARGV[1]; local wallet=ARGV[2]
local ownerId=scope..':'..wallet
local raw=redis.call('HGET',db,'wallet:'..ownerId)
if op=='register' then
 local account=ARGV[3]; local agent=ARGV[4]; local reference=ARGV[5]
 if raw then
  local old=cjson.decode(raw)
  if old.accountAddress~=account or old.agentWalletAddress~=agent or old.reviewReference~=reference then return redis.error_reply('Binding is immutable; rotation requires review') end
 else
  if redis.call('HEXISTS',db,'venue:'..account)==1 or redis.call('HEXISTS',db,'api:'..agent)==1 or redis.call('HEXISTS',db,'api:'..account)==1 or redis.call('HEXISTS',db,'venue:'..agent)==1 then return redis.error_reply('Venue or API account already assigned') end
  raw=cjson.encode({walletPda=wallet,accountAddress=account,agentWalletAddress=agent,reviewReference=reference})
  redis.call('HSET',db,'wallet:'..ownerId,raw,'venue:'..account,ownerId,'api:'..agent,ownerId)
 end
end
if not raw then return redis.error_reply('Dedicated binding is missing') end
local binding=cjson.decode(raw)
if redis.call('HGET',db,'venue:'..binding.accountAddress)~=ownerId or redis.call('HGET',db,'api:'..binding.agentWalletAddress)~=ownerId then return redis.error_reply('Dedicated binding indexes disagree') end
binding.assignedWalletPdas={wallet}
return cjson.encode(binding)
`;

function canonicalKey(value: string): void {
  if (new PublicKey(value).toBase58() !== value)
    throw new Error("Canonical public key required.");
}
function digest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid delivery digest.");
}
function address(value: string): void {
  if (!/^0x[a-f0-9]{40}$/.test(value))
    throw new Error("Canonical venue address required.");
}

export function createVenueRedisStore(
  command: VenueRedisCommand,
  deployment: { chainGenesisHash: string; programId: string },
  leaseMs = 30_000,
) {
  canonicalKey(deployment.chainGenesisHash);
  canonicalKey(deployment.programId);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 120_000)
    throw new Error("Invalid delivery lease duration.");
  const scope = hashText(
    JSON.stringify([deployment.chainGenesisHash, deployment.programId]),
  );
  const namespace = "clearsig:venue:v2:{hyperliquid_testnet}";
  const run = async (script: string, bucket: string, args: string[]) =>
    command(["EVAL", script, "1", `${namespace}:${bucket}`, scope, ...args]);
  const mutate = async (op: string, id: string, lease: string) => {
    digest(id);
    if (!lease) throw new Error("Missing delivery lease.");
    await run(LEDGER_SCRIPT, "ledger", [op, id, lease]);
  };
  const ledger: AgentVenueBridgePorts["ledger"] = {
    async claim(id, commitment, account) {
      digest(id);
      digest(commitment);
      address(account);
      return JSON.parse(
        String(
          await run(LEDGER_SCRIPT, "ledger", [
            "claim",
            id,
            commitment,
            account,
            randomUUID(),
            String(leaseMs),
          ]),
        ),
      ) as VenueDeliveryClaim;
    },
    async lookup(id, commitment, account) {
      digest(id);
      digest(commitment);
      address(account);
      return JSON.parse(
        String(
          await run(LEDGER_SCRIPT, "ledger", [
            "lookup",
            id,
            commitment,
            account,
          ]),
        ),
      );
    },
    beginSubmission: (id, lease) => mutate("begin", id, lease),
    blockBeforeSubmission: (id, lease) => mutate("block", id, lease),
    markUncertain: (id, lease) => mutate("uncertain", id, lease),
    async complete(id, lease, receipt) {
      digest(id);
      digest(receipt.commitment);
      canonicalKey(receipt.walletPda);
      canonicalKey(receipt.proposalPda);
      address(receipt.accountAddress);
      if (
        receipt.deliveryKey !== id ||
        receipt.protectionVerified !== true ||
        !receipt.entryOrderId ||
        !receipt.stopLossOrderId ||
        !Number.isSafeInteger(receipt.observedAtMs) ||
        receipt.observedAtMs <= 0
      )
        throw new Error("Independently verified protection receipt required.");
      const stable: ProtectedVenueReceipt = {
        deliveryKey: id,
        commitment: receipt.commitment,
        walletPda: receipt.walletPda,
        proposalPda: receipt.proposalPda,
        accountAddress: receipt.accountAddress,
        entryOrderId: receipt.entryOrderId,
        stopLossOrderId: receipt.stopLossOrderId,
        takeProfitOrderId: receipt.takeProfitOrderId,
        protectionVerified: true,
        observedAtMs: receipt.observedAtMs,
      };
      if (JSON.stringify(stable).length > 8192)
        throw new Error("Protection receipt is too large.");
      await run(LEDGER_SCRIPT, "ledger", [
        "complete",
        id,
        lease ?? "",
        JSON.stringify(stable),
      ]);
    },
  };
  return {
    ledger,
    /** Operator-only initial assignment; no route exposes this method. No rotation or reassignment. */
    async registerInitialBinding(
      binding: Omit<DedicatedVenueBinding, "assignedWalletPdas">,
      reviewReference: string,
    ): Promise<void> {
      canonicalKey(binding.walletPda);
      address(binding.accountAddress);
      address(binding.agentWalletAddress);
      if (
        binding.accountAddress === binding.agentWalletAddress ||
        !/^[A-Za-z0-9:_-]{1,128}$/.test(reviewReference)
      )
        throw new Error("Reviewed isolated account assignment required.");
      await run(BINDING_SCRIPT, "bindings", [
        "register",
        binding.walletPda,
        binding.accountAddress,
        binding.agentWalletAddress,
        reviewReference,
      ]);
    },
    async readDedicatedBinding(wallet: string): Promise<DedicatedVenueBinding> {
      canonicalKey(wallet);
      return JSON.parse(
        String(await run(BINDING_SCRIPT, "bindings", ["read", wallet])),
      ) as DedicatedVenueBinding;
    },
  };
}
