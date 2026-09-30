import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { parseIntent, parseWallet } from "@/lib/msig/accounts";
import {
  findAgentRiskAddress,
  findIntentAddress,
  findTypedProposalAddress,
  findWalletAddress,
} from "@/lib/msig/pda";
import type { ExecutedAgentTradeAuthority } from "./serverVenueBridge";
import {
  agentVenueOrderRoute,
  hashText,
  validateAgentVenueOrder,
  type AgentVenueOrderV2,
} from "./serverVenueOrderContract";

type Rpc = Pick<
  Connection,
  "getGenesisHash" | "getMultipleAccountsInfoAndContext"
>;
type Limits = ExecutedAgentTradeAuthority["limits"];
export interface SolanaTradeAuthorityConfig {
  /** Trusted server-owned RPC and pinned deployment, never request parameters. */
  rpc: Rpc;
  deployment: { chainGenesisHash: string; programId: string };
  /** Must resolve actual approved limits, not merely echo a caller's commitment. No default exists. */
  resolveCommittedLimits(input: {
    walletPda: string;
    sessionIdHash: string;
    policyCommitment: string;
    policyBytes: Uint8Array;
  }): Promise<Limits>;
}

/** Real finalized RPC reader. No transaction, signer, browser config or network fallback. */
export function createSolanaTradeAuthorityReader(
  config: SolanaTradeAuthorityConfig,
) {
  const program = canonicalKey(config.deployment.programId);
  const genesis = canonicalKey(config.deployment.chainGenesisHash).toBase58();
  return async (
    proposalAddress: string,
    input: AgentVenueOrderV2,
  ): Promise<ExecutedAgentTradeAuthority> => {
    const order = validateAgentVenueOrder(input);
    if (
      order.programId !== program.toBase58() ||
      order.chainGenesisHash !== genesis
    )
      throw new Error("Untrusted trade deployment.");
    if ((await config.rpc.getGenesisHash()) !== genesis)
      throw new Error("RPC genesis does not match the pinned chain.");
    const proposalKey = canonicalKey(proposalAddress);
    const first = await config.rpc.getMultipleAccountsInfoAndContext(
      [proposalKey],
      { commitment: "finalized" },
    );
    validSlot(first.context.slot);
    const initialBytes = owned(first.value[0], program, 5000);
    const initial = parseProposal(initialBytes);
    if (initial.wallet !== order.walletPda)
      throw new Error("Proposal belongs to another wallet.");
    const walletKey = canonicalKey(order.walletPda);
    const intentKey = canonicalKey(initial.intent);
    const sessionHash = Buffer.from(order.sessionIdHash, "hex");
    const [sessionKey, sessionBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_session"), walletKey.toBuffer(), sessionHash],
      program,
    );
    const [riskKey, riskBump] = findAgentRiskAddress(
      walletKey,
      sessionHash,
      program,
    );
    const snapshot = await config.rpc.getMultipleAccountsInfoAndContext(
      [proposalKey, walletKey, intentKey, sessionKey, riskKey],
      { commitment: "finalized", minContextSlot: first.context.slot },
    );
    validSlot(snapshot.context.slot);
    if (
      snapshot.context.slot < first.context.slot ||
      snapshot.value.length !== 5
    )
      throw new Error("Inconsistent finalized snapshot.");
    const proposalBytes = owned(snapshot.value[0], program, 5000);
    if (!proposalBytes.equals(initialBytes))
      throw new Error(
        "Proposal changed during authority resolution; retry from a fresh snapshot.",
      );
    const proposal = parseProposal(proposalBytes);
    const wallet = parseWallet(owned(snapshot.value[1], program, 256));
    const intentBytes = owned(snapshot.value[2], program, 65536);
    const intent = parseIntent(intentBytes);
    const [walletPda, walletBump] = findWalletAddress(
      wallet.name,
      canonicalKey(wallet.creator),
      program,
    );
    const [intentPda, intentBump] = findIntentAddress(
      walletKey,
      intent.intentIndex,
      program,
    );
    const [proposalPda, proposalBump] = findTypedProposalAddress(
      intentKey,
      proposal.index,
      program,
    );
    if (
      !walletPda.equals(walletKey) ||
      wallet.bump !== walletBump ||
      !intentPda.equals(intentKey) ||
      intent.bump !== intentBump ||
      !proposalPda.equals(proposalKey) ||
      proposal.bump !== proposalBump ||
      intent.wallet !== order.walletPda
    )
      throw new Error("Canonical authority PDA or bump mismatch.");
    if (
      !/^[\x20-\x7e]{1,64}$/.test(wallet.name) ||
      intentBytes[37] !== 1 ||
      intent.chainKind !== 5 ||
      intent.approvers.length < 1 ||
      intent.approvers.length > 16 ||
      new Set(intent.approvers).size !== intent.approvers.length ||
      intent.approvalThreshold < 1 ||
      intent.approvalThreshold > intent.approvers.length ||
      !intent.proposers.includes(proposal.proposer)
    )
      throw new Error("Invalid trade intent authority.");
    const mask = (1 << intent.approvers.length) - 1;
    const approvals = popcount(proposal.approvalBitmap);
    if (
      (proposal.approvalBitmap & ~mask) !== 0 ||
      (proposal.cancellationBitmap & ~mask) !== 0 ||
      (proposal.approvalBitmap & proposal.cancellationBitmap) !== 0 ||
      approvals < intent.approvalThreshold
    )
      throw new Error(
        "Executed trade lacks valid threshold approval evidence.",
      );
    const policyCommitment = policyHash(proposal.policyBytes);
    const payloadHash = tradePayloadHash(order);
    if (
      proposal.actionId.toString("hex") !== hashText(order.actionId) ||
      proposal.actionId.length !== 32 ||
      proposal.nonce.length !== 32 ||
      !proposal.nonce.some(Boolean) ||
      proposal.policyCommitment !== order.policyCommitment ||
      policyCommitment !== order.policyCommitment ||
      proposal.payloadHash !== payloadHash ||
      proposal.expiresAtMs !== order.expiresAtMs
    )
      throw new Error("Canonical proposal differs from the exact venue order.");
    const envelope = hash(
      Buffer.concat([
        bytes("clearsig:policy-engine:v4"),
        Buffer.from([4, 9, 7]),
        uint(proposal.index, 8),
        bytes(wallet.name),
        bytes(walletKey.toBuffer()),
        bytes(canonicalKey(proposal.proposer).toBuffer()),
        bytes(proposal.actionId),
        bytes(proposal.nonce),
        uint(BigInt(proposal.expiresAtMs / 1000), 8),
        Buffer.from([intent.approvalThreshold]),
        Buffer.from(policyCommitment, "hex"),
        Buffer.from(payloadHash, "hex"),
        Buffer.from(hash(proposal.clearText), "hex"),
      ]),
    );
    if (envelope !== proposal.envelopeHash)
      throw new Error("Canonical v4 envelope verification failed.");
    const session = parseSession(
      owned(snapshot.value[3], program, 239),
      sessionBump,
    );
    const risk = parseRisk(owned(snapshot.value[4], program, 187), riskBump);
    if (
      session.walletPda !== order.walletPda ||
      session.sessionIdHash !== order.sessionIdHash ||
      risk.walletPda !== order.walletPda ||
      risk.sessionIdHash !== order.sessionIdHash
    )
      throw new Error("Session or risk account identity mismatch.");
    const limits = await config.resolveCommittedLimits({
      walletPda: order.walletPda,
      sessionIdHash: order.sessionIdHash,
      policyCommitment,
      policyBytes: Uint8Array.from(proposal.policyBytes),
    });
    if (limits.policyCommitment !== policyCommitment)
      throw new Error(
        "Resolved risk limits do not match the canonical policy.",
      );
    return {
      finalized: true,
      chainGenesisHash: genesis,
      ownerProgramId: program.toBase58(),
      proposalPda: proposalAddress,
      walletPda: order.walletPda,
      actionKind: 9,
      clearSignVersion: 4,
      status: "executed",
      approvals,
      threshold: intent.approvalThreshold,
      canonical: {
        actionId: order.actionId,
        agentIdHash: order.agentIdHash,
        sessionIdHash: order.sessionIdHash,
        venueHash: hashText(order.venue),
        marketHash: hashText(order.market),
        sideHash: hashText(order.side),
        assetIdHash: hashText(`USDC:${order.venue}`),
        notionalUsdRaw: order.notionalUsdRaw,
        leverageX100: order.leverageX100,
        route: agentVenueOrderRoute(order),
        policyCommitment,
        riskCheckHash: order.riskCheckHash,
        expiresAtMs: order.expiresAtMs,
      },
      session,
      risk,
      limits,
    };
  };
}

function canonicalKey(value: string): PublicKey {
  const key = new PublicKey(value);
  if (key.toBase58() !== value) throw new Error("Noncanonical public key.");
  return key;
}
function validSlot(slot: number): void {
  if (!Number.isSafeInteger(slot) || slot < 0)
    throw new Error("Invalid finalized slot.");
}
function owned(
  info: AccountInfo<Buffer> | null | undefined,
  owner: PublicKey,
  max: number,
): Buffer {
  if (
    !info ||
    info.executable ||
    !info.owner.equals(owner) ||
    info.data.length > max
  )
    throw new Error(
      "Missing, oversized or incorrectly owned authority account.",
    );
  return Buffer.from(info.data);
}
function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function uint(value: bigint, size: number): Buffer {
  if (value < 0n || value >= 1n << BigInt(size * 8))
    throw new Error("Canonical integer out of range.");
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    out[i] = Number(value & 255n);
    value >>= 8n;
  }
  return out;
}
function bytes(value: string | Uint8Array): Buffer {
  const raw = Buffer.from(value);
  return Buffer.concat([uint(BigInt(raw.length), 4), raw]);
}
function policyHash(policy: Buffer): string {
  return hash(
    Buffer.concat([
      bytes("clearsig:policy-engine:v2:policy"),
      uint(2n, 4),
      bytes(
        policy.subarray(0, 4).toString() === "CSP2"
          ? "typed-asset-send-policy-v2"
          : "typed-sol-send-policy-v1",
      ),
      bytes(policy),
    ]),
  );
}
function tradePayloadHash(order: AgentVenueOrderV2): string {
  const digestBytes = (value: string) => bytes(Buffer.from(value, "hex"));
  return hash(
    Buffer.concat([
      bytes("clearsig:policy-engine:v2:payload"),
      Buffer.from([9]),
      digestBytes(order.agentIdHash),
      digestBytes(hashText(order.venue)),
      digestBytes(hashText(order.market)),
      digestBytes(hashText(order.side)),
      digestBytes(hashText(`USDC:${order.venue}`)),
      uint(BigInt(order.notionalUsdRaw), 16),
      uint(BigInt(order.leverageX100), 4),
      digestBytes(order.sessionIdHash),
      digestBytes(hashText(agentVenueOrderRoute(order))),
      digestBytes(order.riskCheckHash),
    ]),
  );
}
class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  take(n: number): Buffer {
    if (!Number.isSafeInteger(n) || n < 0 || this.offset + n > this.data.length)
      throw new Error("Truncated authority account.");
    const value = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return value;
  }
  u8() {
    return this.take(1)[0];
  }
  u16() {
    return this.take(2).readUInt16LE();
  }
  u32() {
    return this.take(4).readUInt32LE();
  }
  u64() {
    return this.take(8).readBigUInt64LE();
  }
  u128() {
    const low = this.u64();
    return (low | (this.u64() << 64n)).toString();
  }
  time() {
    const seconds = this.take(8).readBigInt64LE();
    const ms = seconds * 1000n;
    if (ms <= 0n || ms > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Invalid authority expiry.");
    return Number(ms);
  }
  key() {
    return new PublicKey(this.take(32)).toBase58();
  }
  hex() {
    return this.take(32).toString("hex");
  }
  vec(max: number) {
    const size = this.u32();
    if (size > max) throw new Error("Oversized authority field.");
    return this.take(size);
  }
  end() {
    if (this.take(this.data.length - this.offset).some(Boolean))
      throw new Error("Unknown authority account tail.");
  }
}
function parseProposal(data: Buffer) {
  const r = new Reader(data);
  if (r.u8() !== 6) throw new Error("Expected typed proposal.");
  const wallet = r.key();
  const intent = r.key();
  const index = r.u64();
  const proposer = r.key();
  if (r.u8() !== 2 || r.u8() !== 9)
    throw new Error("Expected executed agent trade proposal.");
  r.take(16);
  const expiresAtMs = r.time();
  const bump = r.u8();
  const approvalBitmap = r.u16();
  const cancellationBitmap = r.u16();
  r.take(32);
  const policyCommitment = r.hex();
  const payloadHash = r.hex();
  const envelopeHash = r.hex();
  const actionId = r.vec(128);
  const nonce = r.vec(128);
  const policyBytes = r.vec(2048);
  const clearText = r.vec(1792);
  r.end();
  if (
    !clearText.length ||
    clearText.toString("utf8").split("Protocol: clearsig-intent-v4@1")
      .length !== 2
  )
    throw new Error("Expected canonical v4 signer document.");
  return {
    wallet,
    intent,
    index,
    proposer,
    expiresAtMs,
    bump,
    approvalBitmap,
    cancellationBitmap,
    policyCommitment,
    payloadHash,
    envelopeHash,
    actionId,
    nonce,
    policyBytes,
    clearText,
  };
}
function parseSession(
  data: Buffer,
  expectedBump: number,
): ExecutedAgentTradeAuthority["session"] {
  const r = new Reader(data);
  if (data.length !== 239 || r.u8() !== 9)
    throw new Error("Invalid session layout.");
  const walletPda = r.key();
  const sessionIdHash = r.hex();
  const agentIdHash = r.hex();
  const venueHash = r.hex();
  const marketHash = r.hex();
  const policyCommitment = r.hex();
  const maxNotionalRaw = r.u128();
  const maxLeverageX100 = r.u32();
  const expiresAtMs = r.time();
  const spentNotionalRaw = r.u128();
  const status = r.u8();
  if (![1, 2].includes(status) || r.u8() !== expectedBump)
    throw new Error("Invalid session status or bump.");
  return {
    walletPda,
    sessionIdHash,
    agentIdHash,
    venueHash,
    marketHash,
    policyCommitment,
    maxNotionalRaw,
    maxLeverageX100,
    expiresAtMs,
    spentNotionalRaw,
    active: status === 1,
  };
}
function parseRisk(
  data: Buffer,
  expectedBump: number,
): ExecutedAgentTradeAuthority["risk"] {
  const r = new Reader(data);
  if (data.length !== 187 || r.u8() !== 10)
    throw new Error("Invalid risk layout.");
  const walletPda = r.key();
  const sessionIdHash = r.hex();
  r.take(32);
  const maxLossRaw = r.u128();
  const realizedLossRaw = r.u128();
  const openNotionalRaw = r.u128();
  r.take(40);
  const status = r.u8();
  if (![1, 2].includes(status) || r.u8() !== expectedBump)
    throw new Error("Invalid risk status or bump.");
  return {
    walletPda,
    sessionIdHash,
    maxLossRaw,
    realizedLossRaw,
    openNotionalRaw,
    active: status === 1,
  };
}
function popcount(value: number): number {
  let count = 0;
  for (; value; value >>>= 1) count += value & 1;
  return count;
}
