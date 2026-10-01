"use client";
import { Button } from "@/components/retail/Button";
/** Existing request evidence is retained while status checks remain read-only. */
export function ExecutionRecoveryNotice({
  proposal,
  txid,
  onCheck,
  checking,
  disabled,
}: {
  proposal: string;
  txid?: string;
  onCheck: () => void;
  checking: boolean;
  disabled: boolean;
}) {
  return (
    <section
      role="status"
      className="rounded-card border border-border-soft bg-surface-raised p-5"
    >
      <h2 className="font-display text-base text-text-strong">
        Execution verification pending
      </h2>
      <p className="mt-2 text-sm text-text-soft">
        An execution attempt for this request may already have been submitted.
        Check status without submitting again. A transaction ID or successful
        server response is not final confirmation.
      </p>
      <p className="mt-2 break-all font-mono text-xs">Request: {proposal}</p>
      {txid && (
        <p className="mt-2 break-all font-mono text-xs">
          Recorded submission ID (not confirmation): {txid}
        </p>
      )}
      <p className="mt-2 text-sm text-text-soft">
        If the request remains approved or destination status is unknown, the
        transaction needs reconciliation before another attempt. This page will
        not retry it blindly.
      </p>
      <Button
        className="mt-4"
        onClick={onCheck}
        disabled={checking || disabled}
      >
        {checking ? "Checking…" : "Check execution status"}
      </Button>
    </section>
  );
}
