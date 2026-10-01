"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { useConnection } from "@/lib/wallet";
import {
  requestRecovery,
  type SavedRequest,
} from "@/lib/clearsign/requestRecovery";
import { Button } from "@/components/retail/Button";
export function SavedRequestNotice({ walletName }: { walletName: string }) {
  const { connection } = useConnection();
  const { accountKey } = useRequestIdentity();
  const entries = useSyncExternalStore(
    requestRecovery.subscribe,
    requestRecovery.snapshot,
    requestRecovery.serverSnapshot,
  );
  const visible = entries.filter(
    (entry) =>
      entry.accountKey === accountKey &&
      entry.walletName === walletName &&
      entry.endpoint === connection.rpcEndpoint,
  );
  if (!visible.length) return null;
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-3">
      {visible.map((entry) => (
        <SavedRequestCard key={entry.key + entry.outcome} entry={entry} />
      ))}
    </div>
  );
}
export function SavedRequestCard({
  entry,
  onAcknowledge = requestRecovery.acknowledgeSeparateRequest,
}: {
  entry: SavedRequest;
  onAcknowledge?: (key: string) => void;
}) {
  const fingerprint = `${entry.key}:${entry.proposal}:${entry.outcome}`;
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      role="status"
      className="rounded-card border border-border-soft bg-surface-raised p-5 text-text-strong"
    >
      <h2 className="text-lg font-semibold">
        {entry.label}:{" "}
        {entry.outcome === "submitted"
          ? entry.phase === "execution"
            ? "execution submitted; verification pending"
            : "request saved"
          : "submission outcome uncertain"}
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        {entry.phase === "execution"
          ? "An execution attempt for this existing request may already be in progress. Open it to check verified status. Another execution attempt is blocked until its outcome is resolved."
          : entry.outcome === "submitted"
            ? "This request was created. Approval or execution may still be pending; this page has not confirmed that the change is active."
            : "Submission started, but its response was not confirmed. Check this request before repeating the change."}
      </p>
      <p className="mt-3 break-all font-mono text-sm">{entry.proposal}</p>
      {entry.txid && (
        <p className="mt-2 break-all font-mono text-xs">
          Recorded submission ID (not confirmation): {entry.txid}
        </p>
      )}
      <Link
        className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-accent px-5 font-semibold text-text-on-accent focus-visible:outline-2 focus-visible:outline-offset-4"
        href={`/app/proposals/${encodeURIComponent(entry.proposal)}`}
      >
        Open existing request
      </Link>
      {entry.phase !== "execution" && (
        <>
          <label className="mt-4 flex min-h-12 items-start gap-3 text-sm">
            <input
              className="mt-1 h-5 w-5"
              type="checkbox"
              aria-label="I reviewed this request and want to submit a separate change"
              checked={acknowledged === fingerprint}
              onChange={(event) =>
                setAcknowledged(event.target.checked ? fingerprint : null)
              }
            />
            I checked the existing request. I understand that submitting again
            creates a separate change.
          </label>
          <Button
            variant="secondary"
            disabled={acknowledged !== fingerprint}
            onClick={() => {
              try {
                onAcknowledge(entry.key);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Wait for this request to finish.",
                );
              }
            }}
          >
            Allow a separate request
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
