import { textCommitmentHex } from "@/lib/clearsign";
import type {
  ProEscrowMilestone,
  ProEscrowProject,
} from "@/lib/pro/escrow";
import type { PreparedEscrowAction } from "./escrowTypes";

export function buildReleaseExecution(
  project: ProEscrowProject,
  milestone: ProEscrowMilestone,
  amountLamports: number,
): PreparedEscrowAction["execute"] {
  const execution = project.execution;
  if (!execution) {
    return {
      kind: "release",
      recipient: milestone.recipient,
      amountLamports,
      escrowId: project.id,
      milestoneId: milestone.id,
    };
  }
  const amountRaw = decimalToRaw(milestone.amount, execution.decimals);
  const common = {
    escrowId: project.id,
    milestoneId: milestone.id,
  };
  if (execution.mode === "spl") {
    return {
      kind: "spl_release",
      ...common,
      mint: required(execution.mint, "SPL mint"),
      sourceToken: required(execution.sourceToken, "treasury token account"),
      destinationToken: required(
        milestone.tokenAccount,
        "recipient token account",
      ),
      recipientOwner: milestone.recipient,
      amountTokens: rawToSafeNumber(amountRaw, "token amount"),
    };
  }
  const hashes = {
    amountRaw,
    recipientHash: textCommitmentHex(milestone.recipient),
    assetIdHash: textCommitmentHex(execution.assetId),
    settlementArtifactHash: required(
      execution.settlementArtifactHash,
      "settlement artifact hash",
    ),
  };
  if (execution.mode === "cross_chain") {
    return {
      kind: "cross_chain_release",
      ...common,
      ...hashes,
      chainKind: execution.chainKind,
      routeHash: required(execution.routeHash, "route hash"),
    };
  }
  return {
    kind: "private_release",
    ...common,
    ...hashes,
    privateEvaluationHash: required(
      execution.privateEvaluationHash,
      "private evaluation hash",
    ),
  };
}

export function buildReturnExecution(
  project: ProEscrowProject,
  rows: Array<{ recipient: string; amount: string }>,
  nativeReturns: Array<{ recipient: string; amountLamports: number }>,
): PreparedEscrowAction["execute"] {
  const execution = project.execution;
  if (!execution) {
    return { kind: "return", escrowId: project.id, returns: nativeReturns };
  }
  if (execution.mode === "spl") {
    return {
      kind: "spl_return",
      mint: required(execution.mint, "SPL mint"),
      sourceToken: required(execution.sourceToken, "treasury token account"),
      escrowId: project.id,
      returns: rows.map((row) => {
        const funder = project.funders.find(
          (candidate) => candidate.address === row.recipient,
        );
        return {
          destinationToken: required(
            funder?.tokenAccount,
            "funder token account",
          ),
          funderOwner: row.recipient,
          amountTokens: rawToSafeNumber(
            decimalToRaw(row.amount, execution.decimals),
            "token return amount",
          ),
        };
      }),
    };
  }
  const row = rows[0];
  if (!row || rows.length !== 1) {
    throw new Error(
      "This settlement rail requires exactly one return recipient.",
    );
  }
  const common = {
    amountRaw: decimalToRaw(row.amount, execution.decimals),
    escrowId: project.id,
    refundRecipientHash: textCommitmentHex(row.recipient),
    assetIdHash: textCommitmentHex(execution.assetId),
    settlementArtifactHash: required(
      execution.settlementArtifactHash,
      "settlement artifact hash",
    ),
  };
  if (execution.mode === "cross_chain") {
    return {
      kind: "cross_chain_return",
      ...common,
      chainKind: execution.chainKind,
      routeHash: required(execution.routeHash, "route hash"),
    };
  }
  return {
    kind: "private_return",
    ...common,
    privateEvaluationHash: required(
      execution.privateEvaluationHash,
      "private evaluation hash",
    ),
  };
}

export function decimalToRaw(value: string, decimals: number): string {
  const normalized = value.trim();
  const pattern =
    decimals === 0
      ? /^\d+$/
      : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !pattern.test(normalized)
  ) {
    throw new Error(`Enter an amount with at most ${decimals} decimals.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  ).toString();
}

function rawToSafeNumber(value: string, label: string): number {
  const amount = BigInt(value);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the browser-safe execution range.`);
  }
  return Number(amount);
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Escrow is missing ${label}.`);
  return normalized;
}
