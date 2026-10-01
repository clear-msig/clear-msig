"use client";
import { useState } from "react";
import Link from "next/link";
import type { SavedSend } from "../domain/sendRecovery";
export function SavedSendRecovery({
  saved,
  walletName,
  onStartAnother,
}: {
  saved: SavedSend;
  walletName: string;
  onStartAnother?: () => void;
}) {
  const fingerprint = JSON.stringify([
    walletName,
    saved.proposal,
    saved.outcome,
  ]);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const checked = acknowledged === fingerprint;
  return (
    <section
      role="status"
      className="rounded-card border border-border-soft bg-surface-raised p-6 text-text-strong"
    >
      <h2 className="text-2xl font-semibold">
        {saved.outcome === "submitted"
          ? "Your request is saved"
          : "Check your request before retrying"}
      </h2>
      <p className="mt-3 text-sm text-text-soft">
        {saved.outcome === "submitted"
          ? "The request was created, but this screen has not confirmed completion. Continue from the existing request to avoid sending twice."
          : "Submission started, but its outcome is not confirmed. It may have created a request. Check its status before starting another send."}
      </p>
      <p className="mt-4 text-xs text-text-soft">Request address</p>
      <p className="break-all font-mono text-sm">{saved.proposal}</p>
      {saved.txid && <p className="mt-3 break-all font-mono text-xs">Recorded submission ID (not confirmation): {saved.txid}</p>}
      <Link
        className="mt-6 flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-text-on-accent focus-visible:outline-2 focus-visible:outline-offset-4"
        href={`/app/proposals/${encodeURIComponent(saved.proposal)}`}
      >
        Open request
      </Link>
      <Link
        className="mt-3 flex min-h-12 items-center justify-center underline focus-visible:outline-2 focus-visible:outline-offset-4"
        href={`/app/wallet/${encodeURIComponent(walletName)}`}
      >
        Back to wallet
      </Link>
      {onStartAnother && (
        <div className="mt-6 border-t border-border-soft pt-4">
          <label className="flex min-h-12 cursor-pointer items-start gap-3 text-sm">
            <input
              className="mt-1 h-5 w-5"
              type="checkbox"
              aria-label="I checked the existing request and understand that a separate send could pay again"
              checked={checked}
              onChange={(event) =>
                setAcknowledged(event.target.checked ? fingerprint : null)
              }
            />
            I checked the existing request. I understand that a separate send
            could pay the recipient again.
          </label>
          <button
            className="mt-2 min-h-12 w-full rounded-xl border border-border-soft px-4 font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4"
            type="button"
            disabled={!checked}
            onClick={onStartAnother}
          >
            Start a separate send
          </button>
        </div>
      )}
    </section>
  );
}
