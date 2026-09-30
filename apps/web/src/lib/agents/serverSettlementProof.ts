import { PublicKey } from "@solana/web3.js";
import { nonnegativeRaw, positiveRaw } from "./serverVenueOrderContract";

export interface ExpectedAgentSettlement {
  chainGenesisHash: string;
  programId: string;
  walletPda: string;
  policyCommitment: string;
  sessionIdHash: string;
  executionIdHash: string;
  settlementArtifactHash: string;
  oraclePolicyHash: string;
  closedNotionalRaw: string;
  outcome: 1 | 2 | 3;
  pnlAbsRaw: string;
  settlementSequence: string;
}

/** Returned only by a pinned, owner/layout/PDA/canonical-byte verifying reader. */
export interface ExecutedAgentSettlementAuthority {
  chainGenesisHash: string;
  ownerProgramId: string;
  walletPda: string;
  proposalPda: string;
  finalized: boolean;
  status: "executed";
  actionKind: 14;
  clearSignVersion: 4;
  threshold: number;
  approvals: number;
  canonical: Omit<
    ExpectedAgentSettlement,
    "chainGenesisHash" | "programId" | "walletPda"
  >;
}

/**
 * Exact promotion contract. Merely observing any Executed proposal is not
 * settlement proof. The route remains blocked until a real trusted reader and
 * immutable native-evidence claim repository are connected to this validator.
 */
export function verifyExecutedAgentSettlement(
  expected: ExpectedAgentSettlement,
  authority: ExecutedAgentSettlementAuthority,
): { proposalPda: string; status: "executed"; artifactHash: string } {
  validateExpectedAgentSettlement(expected, authority.proposalPda);
  if (
    !authority.finalized ||
    authority.status !== "executed" ||
    authority.actionKind !== 14 ||
    authority.clearSignVersion !== 4 ||
    authority.chainGenesisHash !== expected.chainGenesisHash ||
    authority.ownerProgramId !== expected.programId ||
    authority.walletPda !== expected.walletPda ||
    !Number.isSafeInteger(authority.threshold) ||
    authority.threshold < 1 ||
    !Number.isSafeInteger(authority.approvals) ||
    authority.approvals < authority.threshold
  ) {
    throw new Error(
      "Finalized threshold-executed settlement authority is required.",
    );
  }
  const {
    chainGenesisHash: _chain,
    programId: _program,
    walletPda: _wallet,
    ...canonical
  } = expected;
  void _chain;
  void _program;
  void _wallet;
  if (
    Object.entries(canonical).some(
      ([key, value]) =>
        authority.canonical[key as keyof typeof canonical] !== value,
    )
  ) {
    throw new Error(
      "Settlement proof does not match the exact session, execution, venue artifact and accounting claim.",
    );
  }
  return {
    proposalPda: authority.proposalPda,
    status: "executed",
    artifactHash: expected.settlementArtifactHash,
  };
}

export function validateExpectedAgentSettlement(
  expected: ExpectedAgentSettlement,
  proposalPda: string,
): void {
  for (const value of [
    expected.chainGenesisHash,
    expected.programId,
    expected.walletPda,
    proposalPda,
  ]) {
    if (new PublicKey(value).toBase58() !== value)
      throw new Error("Settlement chain identity is invalid.");
  }
  for (const value of [
    expected.policyCommitment,
    expected.sessionIdHash,
    expected.executionIdHash,
    expected.settlementArtifactHash,
    expected.oraclePolicyHash,
  ]) {
    if (!/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value))
      throw new Error("Settlement commitment is invalid.");
  }
  positiveRaw(expected.closedNotionalRaw);
  const pnl = nonnegativeRaw(expected.pnlAbsRaw);
  if (
    ![1, 2, 3].includes(expected.outcome) ||
    (expected.outcome === 3 ? pnl !== 0n : pnl === 0n) ||
    nonnegativeRaw(expected.settlementSequence) > (1n << 64n) - 1n
  ) {
    throw new Error("Settlement accounting fields are invalid.");
  }
}
