import type { Connection } from "@solana/web3.js";
import type { PreparedEscrowAction } from "../domain/escrowTypes";
import { backendApi } from "@/lib/api/endpoints";
import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
import { readCanonicalProposalReview } from "@/lib/clearsign/readProposalReview";

export type EscrowOperation = {
  version: 1;
  walletName: string;
  proposalAddress: string;
  envelopeHash: string;
  payloadHash: string;
  execute: PreparedEscrowAction["execute"];
  phase:
    | "creating"
    | "created"
    | "executing"
    | "submitted"
    | "unknown"
    | "confirmed"
    | "cancelled";
  txid?: string;
};
export type EscrowEvidence = {
  sections: readonly { title: string; text: string }[];
  envelopeHash: string;
  payloadHash: string;
  proposalAddress: string;
  binding: { actionKind: number };
  status: number;
};
export function assertEscrowEvidence(
  record: EscrowOperation,
  evidence: EscrowEvidence,
) {
  if (
    evidence.proposalAddress !== record.proposalAddress ||
    evidence.envelopeHash !== record.envelopeHash ||
    evidence.payloadHash !== record.payloadHash ||
    evidence.binding.actionKind !==
      (record.execute.kind.endsWith("release") ? 7 : 8)
  ) {
    throw new Error(
      "Finalized escrow evidence does not match the saved canonical request.",
    );
  }
  const details =
    evidence.sections
      .find((section) => section.title === "DETAILS")
      ?.text.split("\n") ?? [];
  const field = (name: string, value: string) =>
    details.filter((line) => line.startsWith(`${name}: `)).length === 1 &&
    details.includes(`${name}: ${value}`);
  if (
    !field("Escrow ID", record.execute.escrowId) ||
    ("milestoneId" in record.execute &&
      !field("Milestone ID", record.execute.milestoneId))
  )
    throw new Error(
      "Saved escrow identity differs from the canonical document.",
    );
}
export const escrowPaths: Record<
  PreparedEscrowAction["execute"]["kind"],
  string
> = {
  release: "typed_escrow_release",
  return: "typed_escrow_return",
  spl_release: "typed_spl_escrow_release",
  spl_return: "typed_spl_escrow_return",
  cross_chain_release: "typed_cross_chain_escrow_release",
  cross_chain_return: "typed_cross_chain_escrow_return",
  private_release: "typed_private_escrow_release",
  private_return: "typed_private_escrow_return",
};
export function escrowOperationKey(
  walletName: string,
  project: string,
  endpoint: string,
) {
  return `clear.escrow-operation.v1:${encodeURIComponent(endpoint)}:${encodeURIComponent(walletName)}:${encodeURIComponent(project)}`;
}
export function loadEscrowOperation(key: string): EscrowOperation | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const record = JSON.parse(raw) as EscrowOperation;
  if (
    record.version !== 1 ||
    !record.proposalAddress ||
    !/^[a-f0-9]{64}$/.test(record.envelopeHash) ||
    !/^[a-f0-9]{64}$/.test(record.payloadHash) ||
    !record.execute ||
    !Object.hasOwn(escrowPaths, record.execute.kind) ||
    ![
      "creating",
      "created",
      "executing",
      "submitted",
      "unknown",
      "confirmed",
      "cancelled",
    ].includes(record.phase)
  )
    throw new Error(
      "Saved escrow recovery data is invalid. Do not create another request; review the existing proposal history.",
    );
  return record;
}
export function saveEscrowOperation(key: string, record: EscrowOperation) {
  const encoded = JSON.stringify(record);
  window.localStorage.setItem(key, encoded);
  if (window.localStorage.getItem(key) !== encoded)
    throw new Error(
      "Escrow recovery details could not be saved; submission is blocked.",
    );
}
export async function readEscrowEvidence(
  connection: Connection,
  record: EscrowOperation,
) {
  const review = await readCanonicalProposalReview(
    connection,
    record.proposalAddress,
    record.walletName,
  );
  const evidence = { ...review, proposalAddress: review.proposalAddress };
  assertEscrowEvidence(record, evidence);
  return evidence;
}
export async function submitEscrowExecution(record: EscrowOperation) {
  const e = record.execute;
  const w = record.walletName,
    p = record.proposalAddress,
    options = { retry: false };
  switch (e.kind) {
    case "release":
      return backendApi.executeTypedEscrowRelease(w, p, e, options);
    case "return":
      return backendApi.executeTypedEscrowReturn(w, p, e, options);
    case "spl_release":
      return backendApi.executeTypedSplEscrowRelease(w, p, e, options);
    case "spl_return":
      return backendApi.executeTypedSplEscrowReturn(w, p, e, options);
    case "cross_chain_release":
      return backendApi.executeTypedCrossChainEscrowRelease(w, p, e, options);
    case "cross_chain_return":
      return backendApi.executeTypedCrossChainEscrowReturn(w, p, e, options);
    case "private_release":
      return backendApi.executeTypedPrivateEscrowRelease(w, p, e, options);
    case "private_return":
      return backendApi.executeTypedPrivateEscrowReturn(w, p, e, options);
  }
}
/** An explicit first execution only. Unknown or submitted work can only be rechecked. */
export async function executeSavedEscrow(
  record: EscrowOperation,
  deps: {
    read: (record: EscrowOperation) => Promise<EscrowEvidence>;
    submit: (record: EscrowOperation) => Promise<unknown>;
    save: (record: EscrowOperation) => void;
  },
): Promise<EscrowOperation> {
  if (record.phase !== "created")
    throw new Error(
      "This request was already attempted. Recheck the existing request; do not submit it again.",
    );
  const before = await deps.read(record);
  assertEscrowEvidence(record, before);
  if (before.status === 2) {
    const done = { ...record, phase: "confirmed" as const };
    deps.save(done);
    return done;
  }
  if (before.status === 3) {
    const cancelled = { ...record, phase: "cancelled" as const };
    deps.save(cancelled);
    return cancelled;
  }
  if (before.status !== 1) return record;
  const attempted = { ...record, phase: "executing" as const };
  deps.save(attempted);
  try {
    const response = await deps.submit(attempted);
    const txid = solanaSubmissionTxid(response, {
      proposal: record.proposalAddress,
      path: escrowPaths[record.execute.kind],
      requireProposal: true,
    });
    const submitted = { ...record, phase: "submitted" as const, txid };
    deps.save(submitted);
    try {
      const after = await deps.read(submitted);
      assertEscrowEvidence(record, after);
      if (after.status === 2) {
        const done = { ...submitted, phase: "confirmed" as const };
        deps.save(done);
        return done;
      }
    } catch {
      /* Submission is not finalized evidence. */
    }
    return submitted;
  } catch {
    const unknown = { ...attempted, phase: "unknown" as const };
    deps.save(unknown);
    return unknown;
  }
}
