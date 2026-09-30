import { PublicKey } from "@solana/web3.js";
import { hashText } from "./serverVenueOrderContract";
import type { VenueRedisCommand } from "./serverVenueRedis";
import {
  assertVerifiedHyperliquidSettlement,
  type VerifiedHyperliquidSettlement,
} from "./hyperliquidSettlementEvidence";

interface StoredSettlementEvidence {
  version: 1;
  walletPda: string;
  executionIdHash: string;
  sessionIdHash: string;
  evidence: VerifiedHyperliquidSettlement;
}

const READ_SCRIPT = `
local ownerId=ARGV[1]..':'..ARGV[2]
local raw=redis.call('HGET',KEYS[2],'execution:'..ownerId..':'..ARGV[3])
if not raw then return false end
local record=cjson.decode(raw)
local bindingRaw=redis.call('HGET',KEYS[1],'wallet:'..ownerId)
if not bindingRaw then return redis.error_reply('Missing dedicated venue binding') end
local binding=cjson.decode(bindingRaw)
if record.walletPda~=ARGV[2] or record.executionIdHash~=ARGV[3] or record.evidence.venueEvidence.accountAddress~=binding.accountAddress or redis.call('HGET',KEYS[1],'venue:'..binding.accountAddress)~=ownerId then return redis.error_reply('Stored evidence identity mismatch') end
return raw
`;

const SCRIPT = `
local bindings=KEYS[1]; local claims=KEYS[2]
local scope=ARGV[1]; local wallet=ARGV[2]; local execution=ARGV[3]; local encoded=ARGV[4]
local record=cjson.decode(encoded)
local ownerId=scope..':'..wallet
local raw=redis.call('HGET',bindings,'wallet:'..ownerId)
if not raw then return redis.error_reply('Missing dedicated venue binding') end
local binding=cjson.decode(raw)
if binding.accountAddress~=record.evidence.venueEvidence.accountAddress or redis.call('HGET',bindings,'venue:'..binding.accountAddress)~=ownerId then return redis.error_reply('Evidence account does not belong to this wallet') end
local claimId=ownerId..':'..execution
local existing=redis.call('HGET',claims,'execution:'..claimId)
if existing then
 if existing~=encoded then return redis.error_reply('Conflicting immutable settlement evidence') end
 return existing
end
local orderKey='order:'..binding.accountAddress..':'..record.evidence.venueEvidence.orderId
if redis.call('HEXISTS',claims,orderKey)==1 then return redis.error_reply('Closing order already claimed') end
for _,fill in ipairs(record.evidence.venueEvidence.fills) do
 local fillKey='fill:'..binding.accountAddress..':'..fill.tradeId
 if redis.call('HEXISTS',claims,fillKey)==1 then return redis.error_reply('Native fill already claimed') end
end
redis.call('HSET',claims,'execution:'..claimId,encoded,orderKey,claimId)
for _,fill in ipairs(record.evidence.venueEvidence.fills) do
 redis.call('HSET',claims,'fill:'..binding.accountAddress..':'..fill.tradeId,claimId)
end
return encoded
`;

/** Native evidence consumption, not proof that this order closed a particular opening execution. */
export function createSettlementEvidenceStore(
  command: VenueRedisCommand,
  deployment: { chainGenesisHash: string; programId: string },
) {
  for (const key of [deployment.chainGenesisHash, deployment.programId])
    canonicalKey(key);
  const scope = hashText(
    JSON.stringify([deployment.chainGenesisHash, deployment.programId]),
  );
  const namespace = "clearsig:venue:v2:{hyperliquid_testnet}";
  return {
    /** Recover the immutable stored artifact after restart; this does not mint fresh verification provenance. */
    async read(
      walletPda: string,
      executionIdHash: string,
    ): Promise<StoredSettlementEvidence | null> {
      canonicalKey(walletPda);
      if (
        !/^[a-f0-9]{64}$/.test(executionIdHash) ||
        /^0+$/.test(executionIdHash)
      )
        throw new Error("Canonical execution identity required.");
      const raw = await command([
        "EVAL",
        READ_SCRIPT,
        "2",
        `${namespace}:bindings`,
        `${namespace}:settlement-evidence`,
        scope,
        walletPda,
        executionIdHash,
      ]);
      if (raw === null) return null;
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 50_000)
        throw new Error("Invalid stored native evidence.");
      const record = JSON.parse(raw) as StoredSettlementEvidence;
      if (
        record.version !== 1 ||
        record.walletPda !== walletPda ||
        record.executionIdHash !== executionIdHash
      )
        throw new Error("Stored native evidence identity mismatch.");
      return record;
    },
    async claim(input: {
      walletPda: string;
      executionIdHash: string;
      sessionIdHash: string;
      evidence: VerifiedHyperliquidSettlement;
    }): Promise<{ evidenceHash: string }> {
      canonicalKey(input.walletPda);
      for (const digest of [input.executionIdHash, input.sessionIdHash])
        if (!/^[a-f0-9]{64}$/.test(digest) || /^0+$/.test(digest))
          throw new Error("Canonical execution/session identity required.");
      assertVerifiedHyperliquidSettlement(input.evidence);
      // Copy exactly the verified fields before awaiting storage. Caller mutation
      // after this point cannot change the persisted claim.
      const record = {
        version: 1,
        walletPda: input.walletPda,
        executionIdHash: input.executionIdHash,
        sessionIdHash: input.sessionIdHash,
        evidence: input.evidence,
      };
      const encoded = JSON.stringify(record);
      if (Buffer.byteLength(encoded, "utf8") > 50_000)
        throw new Error("Native evidence exceeds the durable record bound.");
      const result = await command([
        "EVAL",
        SCRIPT,
        "2",
        `${namespace}:bindings`,
        `${namespace}:settlement-evidence`,
        scope,
        input.walletPda,
        input.executionIdHash,
        encoded,
      ]);
      if (result !== encoded)
        throw new Error(
          "Durable native evidence acknowledgement differs from the submitted claim.",
        );
      return {
        evidenceHash: JSON.parse(encoded).evidence.venueEvidence
          .evidenceHash as string,
      };
    },
  };
}
function canonicalKey(value: string): void {
  if (new PublicKey(value).toBase58() !== value)
    throw new Error("Canonical public key required.");
}
