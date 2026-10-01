"use client";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import type { SavedRequest } from "@/lib/clearsign/requestRecovery";

export function VoteRecoveryNotice({ attempts, check, checking, disabled, onChanged }: {
  attempts: readonly SavedRequest[];
  check: () => Promise<readonly { state: "confirmed" | "submitted" | "unknown" }[]>;
  checking: boolean;
  disabled: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  if (!attempts.length) return null;
  return <section role="status" className="rounded-card border border-border-soft bg-surface-raised p-5">
    <h2 className="font-display text-base text-text-strong">Vote verification pending</h2>
    <p className="mt-2 text-sm text-text-soft">A vote may already have been submitted. Check the existing request without signing or submitting again. A transaction ID alone does not confirm the vote or the quorum.</p>
    <ul className="mt-3 space-y-2 text-xs">
      {attempts.map((attempt) => <li key={attempt.key} className="break-all">
        <p>Request: {attempt.proposal}</p>
        {attempt.txid && <p>Recorded submission ID (not confirmation): {attempt.txid}</p>}
      </li>)}
    </ul>
    <Button className="mt-4" disabled={checking || disabled} onClick={async () => {
      try {
        const outcomes = await check();
        if (outcomes.length && outcomes.every((outcome) => outcome.state === "confirmed")) toast.success("Saved votes confirmed on Solana");
        else toast.info("Vote verification pending; keep the existing request");
        onChanged();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not verify vote status.");
      }
    }}>{checking ? "Checking…" : "Check vote status"}</Button>
  </section>;
}
