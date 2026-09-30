import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { verifyExecutedAgentSettlement, type ExpectedAgentSettlement, type ExecutedAgentSettlementAuthority } from "@/lib/agents/serverSettlementProof";
const key = (value: number) => new PublicKey(new Uint8Array(32).fill(value)).toBase58();
function fixture() {
  const expected: ExpectedAgentSettlement = {
    chainGenesisHash: key(1), programId: key(2), walletPda: key(3), policyCommitment: "f".repeat(64),
    sessionIdHash: "a".repeat(64), executionIdHash: "b".repeat(64),
    settlementArtifactHash: "c".repeat(64), oraclePolicyHash: "d".repeat(64),
    closedNotionalRaw: "250000000", outcome: 2, pnlAbsRaw: "1250000", settlementSequence: "0",
  };
  const { chainGenesisHash, programId, walletPda, ...canonical } = expected;
  const authority: ExecutedAgentSettlementAuthority = { chainGenesisHash, ownerProgramId: programId,
    walletPda, proposalPda: key(4), finalized: true, status: "executed", actionKind: 14,
    clearSignVersion: 4, threshold: 2, approvals: 2, canonical };
  return { expected, authority };
}
describe("exact threshold settlement proof contract", () => {
  it("accepts the exact independently verified settlement commitment", () => {
    const { expected, authority } = fixture();
    expect(verifyExecutedAgentSettlement(expected, authority)).toEqual({ proposalPda: key(4), status: "executed", artifactHash: "c".repeat(64) });
  });
  it.each(["policyCommitment", "sessionIdHash", "executionIdHash", "settlementArtifactHash", "oraclePolicyHash", "closedNotionalRaw", "pnlAbsRaw", "settlementSequence"] as const)("rejects mismatched %s", (field) => {
    const { expected, authority } = fixture();
    authority.canonical[field] = (field.endsWith("Hash") || field === "policyCommitment") ? "e".repeat(64) : "1";
    expect(() => verifyExecutedAgentSettlement(expected, authority)).toThrow("exact session");
  });
  it.each(["wallet", "kind", "threshold", "finality"])("rejects an unrelated executed proposal: %s", (kind) => {
    const { expected, authority } = fixture();
    if (kind === "wallet") authority.walletPda = key(8);
    if (kind === "kind") (authority as { actionKind: number }).actionKind = 9;
    if (kind === "threshold") authority.approvals = 1;
    if (kind === "finality") authority.finalized = false;
    expect(() => verifyExecutedAgentSettlement(expected, authority)).toThrow("settlement authority");
  });
});
