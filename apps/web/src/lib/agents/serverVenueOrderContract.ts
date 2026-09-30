import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

/** New external-order descriptor. Legacy v1 venue:orderType routes never mean v2. */
export interface AgentVenueOrderV2 {
  version: 2;
  chainGenesisHash: string;
  programId: string;
  walletPda: string;
  actionId: string;
  sessionIdHash: string;
  agentIdHash: string;
  policyCommitment: string;
  riskCheckHash: string;
  venue: "hyperliquid_testnet";
  accountAddress: string;
  agentWalletAddress: string;
  market: string;
  side: "long" | "short";
  orderType: "market";
  notionalUsdRaw: string;
  leverageX100: number;
  leverageMode: "isolated";
  maxSlippageBps: number;
  stopLossPrice: string;
  takeProfitPrice: string | null;
  expiresAtMs: number;
}

export function validateAgentVenueOrder(input: AgentVenueOrderV2): AgentVenueOrderV2 {
  if (!input || input.version !== 2 || input.venue !== "hyperliquid_testnet" ||
    input.orderType !== "market" || input.leverageMode !== "isolated" ||
    !["long", "short"].includes(input.side)) throw new Error("Unsupported external order descriptor.");
  for (const key of [input.chainGenesisHash, input.programId, input.walletPda]) {
    if (typeof key !== "string" || new PublicKey(key).toBase58() !== key) throw new Error("Order chain identity is invalid.");
  }
  for (const hash of [input.sessionIdHash, input.agentIdHash, input.policyCommitment, input.riskCheckHash]) {
    if (!/^[a-f0-9]{64}$/.test(hash) || /^0+$/.test(hash)) throw new Error("Order commitment is invalid.");
  }
  if (!/^[A-Za-z0-9_:-]{1,96}$/.test(input.actionId) || !/^[A-Z0-9]{1,20}-PERP$/.test(input.market)) {
    throw new Error("Order identity or market is invalid.");
  }
  for (const address of [input.accountAddress, input.agentWalletAddress]) {
    if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Order venue account is invalid.");
  }
  if (input.accountAddress === input.agentWalletAddress) throw new Error("The API wallet must be separate from the venue account.");
  positiveRaw(input.notionalUsdRaw);
  if (!Number.isSafeInteger(input.leverageX100) || input.leverageX100 < 100 ||
    !Number.isSafeInteger(input.maxSlippageBps) || input.maxSlippageBps < 1 || input.maxSlippageBps > 50 ||
    !Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= 0) throw new Error("Order bounds are invalid.");
  positivePrice(input.stopLossPrice);
  if (input.takeProfitPrice !== null) positivePrice(input.takeProfitPrice);
  // Copy only known fields so caller mutation/extra JSON fields cannot change a
  // descriptor after it has been validated and committed.
  return Object.freeze({
    version: 2, chainGenesisHash: input.chainGenesisHash, programId: input.programId,
    walletPda: input.walletPda, actionId: input.actionId, sessionIdHash: input.sessionIdHash,
    agentIdHash: input.agentIdHash, policyCommitment: input.policyCommitment,
    riskCheckHash: input.riskCheckHash, venue: input.venue, accountAddress: input.accountAddress,
    agentWalletAddress: input.agentWalletAddress, market: input.market, side: input.side,
    orderType: input.orderType, notionalUsdRaw: input.notionalUsdRaw,
    leverageX100: input.leverageX100, leverageMode: input.leverageMode,
    maxSlippageBps: input.maxSlippageBps, stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice, expiresAtMs: input.expiresAtMs,
  });
}

export function agentVenueOrderCommitment(input: AgentVenueOrderV2): string {
  return hashText(`clearsig.agent.venue-order.v2\0${JSON.stringify(validateAgentVenueOrder(input))}`);
}

/** Fits the existing v4 canonical route field's 96-byte bound. */
export function agentVenueOrderRoute(input: AgentVenueOrderV2): string {
  return `hl-order-v2:${agentVenueOrderCommitment(input)}`;
}

export function agentVenueDeliveryKey(order: AgentVenueOrderV2, proposalPda: string): string {
  if (new PublicKey(proposalPda).toBase58() !== proposalPda) throw new Error("Proposal identity is invalid.");
  // Exclude the order digest from the key: one proposal must not acquire a
  // second delivery identity by changing the order. The ledger binds its digest.
  return hashText(JSON.stringify(["clearsig.agent.delivery.v2", order.chainGenesisHash,
    order.programId, order.walletPda, proposalPda]));
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function positiveRaw(value: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,38}$/.test(value)) throw new Error("Atomic USD amount is invalid.");
  const parsed = BigInt(value);
  if (parsed > (1n << 128n) - 1n) throw new Error("Atomic USD amount exceeds u128.");
  return parsed;
}

export function nonnegativeRaw(value: string): bigint {
  return value === "0" ? 0n : positiveRaw(value);
}

export function compareExactPrices(left: string, right: string): number {
  positivePrice(left);
  positivePrice(right);
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(leftWhole + leftFraction.padEnd(scale, "0"));
  const b = BigInt(rightWhole + rightFraction.padEnd(scale, "0"));
  return a === b ? 0 : a < b ? -1 : 1;
}

function positivePrice(value: string): void {
  if (typeof value !== "string" || value.length > 48 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) ||
    !/[1-9]/.test(value)) throw new Error("A positive exact protective-order price is required.");
}
