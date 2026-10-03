"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import {
  loadProposalVoteHistory,
  type ProposalVoteHistoryResult,
} from "@/lib/clearsign/proposalVoteHistory";

export function ProposalVoteHistory({
  proposalAddress,
}: {
  proposalAddress: string;
}) {
  const { connection } = useConnection();
  const [requested, setRequested] = useState(false);
  const history = useQuery({
    queryKey: [
      "proposal-vote-history",
      connection.rpcEndpoint,
      proposalAddress,
    ],
    queryFn: () => loadProposalVoteHistory(connection, proposalAddress),
    enabled: requested,
    retry: false,
    staleTime: 30_000,
  });
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5">
      <h2 className="text-base font-semibold text-text-strong">
        Historical vote evidence
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        Successful finalized vote instructions. A signer is named only when
        their detached signature verifies. Block time records chain inclusion,
        not when a person signed.
      </p>
      <button
        type="button"
        disabled={history.isFetching}
        onClick={() =>
          requested ? void history.refetch() : setRequested(true)
        }
        className="mt-3 min-h-11 rounded-soft border border-border-soft px-4 text-sm text-text-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {history.isFetching
          ? "Checking history…"
          : requested
            ? "Refresh vote evidence"
            : "Load vote evidence"}
      </button>
      {history.isError && (
        <p role="alert" className="mt-3 text-sm text-text-soft">
          Vote history could not be read. This does not mean no votes exist. Any
          displayed evidence is from an earlier read; refresh to try again.
        </p>
      )}
      {history.data && <VoteEvidenceList result={history.data} />}
    </section>
  );
}

export function voteBlockTime(seconds: number | null) {
  if (seconds === null) return "Block time unavailable";
  try {
    return new Date(seconds * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(".000Z", " UTC");
  } catch {
    return "Block time unavailable";
  }
}

export function VoteEvidenceList({
  result,
}: {
  result: ProposalVoteHistoryResult;
}) {
  return (
    <div className="mt-4 space-y-3 text-sm text-text-soft">
      <p>
        Bounded scan: {result.scannedTransactions} transactions checked (maximum
        16).{" "}
        {result.stoppedAtLimit
          ? "Scan limit reached; older evidence may not be shown."
          : "RPC archive coverage is unverified, even when no older results are returned."}{" "}
        This is not a complete vote history.
      </p>
      <p>
        Automatic approval at creation and inner program calls are not
        attributed here. Historical roster changes, older signing formats, or
        unavailable documents can prevent signer verification.
      </p>
      {(result.scanError ||
        result.unavailableTransactions > 0 ||
        result.innerVoteInstructions > 0) && (
        <p role="alert">
          Some evidence is unavailable: {result.unavailableTransactions}{" "}
          unreadable, pruned, or unsupported transactions;{" "}
          {result.innerVoteInstructions} inner vote instructions excluded.
          {result.scanError && " A history page could not be verified or read."}
        </p>
      )}
      {result.failedTransactions > 0 && (
        <p>
          {result.failedTransactions} failed transactions excluded; they are not
          accepted votes.
        </p>
      )}
      {result.rows.length === 0 && (
        <p>
          No supported successful vote evidence was found in this bounded scan.
          Current votes may still exist.
        </p>
      )}
      <ol className="space-y-3">
        {result.rows.map((row) => (
          <li
            key={`${row.transaction}:${row.instructionIndex}`}
            className="rounded-soft border border-border-soft p-3"
          >
            <p className="font-medium text-text-strong">
              {row.vote === "approve"
                ? "Approval instruction succeeded"
                : "Cancellation vote instruction succeeded"}
            </p>
            <p className="mt-2">
              {row.signer
                ? "Verified signer"
                : `Signer unavailable · program member index ${row.memberIndex}`}
            </p>
            {row.signer && (
              <p className="break-all font-mono text-xs text-text-strong">
                {row.signer}
              </p>
            )}
            <p className="mt-1">{row.attribution}</p>
            <p className="mt-2">
              {voteBlockTime(row.blockTime)} · Slot {row.slot} · Instruction{" "}
              {row.instructionIndex}
            </p>
            <p className="mt-2">Transaction</p>
            <p className="break-all font-mono text-xs">{row.transaction}</p>
          </li>
        ))}
      </ol>
      <p>
        Observed chain genesis:{" "}
        <span className="break-all font-mono text-xs">
          {result.chainIdentity}
        </span>
      </p>
    </div>
  );
}
