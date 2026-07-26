import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { buildAgentSettlementClearSign } from "@/lib/agents/settlementClearSign";
import type { AgentRiskLedgerAccount } from "@/lib/agents/agentRiskLedger";

const ledger: AgentRiskLedgerAccount = {
  pda: new PublicKey(new Uint8Array(32).fill(1)),
  wallet: new PublicKey(new Uint8Array(32).fill(2)),
  sessionIdHash: "11".repeat(32),
  oraclePolicyHash: "22".repeat(32),
  maxLossRaw: 100_000_000n,
  realizedLossRaw: 0n,
  openNotionalRaw: 250_000_000n,
  nextSettlementSequence: 4n,
  lastSettlementArtifactHash: "00".repeat(32),
  status: "active",
};

const settlement = {
  requestId: "request-1",
  proposalId: "proposal-1",
  settlementArtifactHash: "33".repeat(32),
  closedNotionalUsd: "250",
  realizedPnlUsd: "-1.250001",
  artifact: {
    exchange: "hyperliquid_testnet" as const,
    network: "testnet" as const,
    serverRequestId: "request-1",
    openingOrderId: "1",
    closingOrderId: "2",
    market: "BTC-PERP",
    side: "long" as const,
    closedSize: "0.0037",
    reservedNotionalUsd: "250",
    realizedPnlUsd: "-1.250001",
    fillHashes: [`0x${"ab".repeat(32)}`],
    settledAt: 1_800_000_000_000,
    venueEvidence: {
      version: 1 as const,
      source: "hyperliquid_info_api" as const,
      network: "testnet" as const,
      accountAddress: "0x1111111111111111111111111111111111111111",
      orderId: "2",
      orderStatus: "filled" as const,
      orderStatusTimestamp: 1_800_000_000_000,
      fills: [],
      evidenceHash: "55".repeat(32),
    },
  },
};

describe("agent settlement ClearSign", () => {
  it("binds trusted loss accounting and chain sequence exactly", () => {
    const built = buildAgentSettlementClearSign({
      walletName: "Treasury",
      walletId: ledger.wallet.toBase58(),
      sessionId: "session-1",
      policyHash: "44".repeat(32),
      ledger,
      settlement,
    });
    expect(built.envelope.payload).toMatchObject({
      outcome: "loss",
      pnlAbsRaw: "1250001",
      closedNotionalRaw: "250000000",
      settlementSequence: 4,
      oraclePolicyHash: "22".repeat(32),
    });
    expect(built.executor.outcome).toBe(2);
  });

  it("rejects a settlement larger than reserved on-chain exposure", () => {
    expect(() => buildAgentSettlementClearSign({
      walletName: "Treasury",
      walletId: ledger.wallet.toBase58(),
      sessionId: "session-1",
      policyHash: "44".repeat(32),
      ledger: { ...ledger, openNotionalRaw: 249_999_999n },
      settlement,
    })).toThrow(/exceeds/);
  });
});
