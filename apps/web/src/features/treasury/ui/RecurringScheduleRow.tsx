import Link from "next/link";
import { Check, Play, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/retail/Button";
import type { PendingRecurringExecution, ProSchedule } from "@/lib/pro/treasury";
import { recurringExecutionApplied, requireRecurringExecution } from "@/features/treasury/domain/recurringExecution";

export function RecurringScheduleRow({ row, state, busy, unavailable, onRetry, onPay, onRevoke, onRemove }: {
  row: ProSchedule;
  state: { status: "active" | "revoked" | "complete"; nextExecutionAt: number; remainingPayments: number; executedPayments: number } | null;
  busy: boolean;
  unavailable: boolean;
  onRetry: () => void;
  onPay: () => void;
  onRevoke: () => void;
  onRemove: () => void;
}) {
  let pending: PendingRecurringExecution | null = null;
  let retryIssue = false;
  if (row.pendingExecution || (!state && row.proposalAddress)) {
    try {
      const saved = requireRecurringExecution(row);
      if (!recurringExecutionApplied(saved, state)) pending = saved;
    } catch {
      retryIssue = true;
    }
  }
  const disabled = busy || unavailable;
  const due = !pending && !retryIssue && state?.status === "active"
    && state.nextExecutionAt <= Math.floor(Date.now() / 1000);
  const label = unavailable ? "Checking chain status"
    : pending ? pending.status === 2 ? "Revocation pending" : "Activation pending"
    : retryIssue ? "Review saved request" : state?.status ?? "Not active";
  return (
    <article className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-text-strong">{row.name}</h3>
          <span className="text-xs capitalize text-accent">{label}</span>
        </div>
        <p className="mt-1 truncate text-xs text-text-soft">{row.amount} {row.asset} · {row.cadence} · {row.address}</p>
        {state && <p className="mt-1 text-xs text-text-soft">{state.executedPayments} paid · {state.remainingPayments} remaining</p>}
        {retryIssue && <p className="mt-1 text-xs text-warning">This older request has no verified retry details. Review its proposal before creating another.</p>}
        {row.proposalAddress && (
          <Link className="mt-1 inline-flex min-h-tap items-center text-xs font-semibold text-accent underline" href={`/app/proposals/${encodeURIComponent(row.proposalAddress)}`}>
            Review proposal
          </Link>
        )}
      </div>
      <div className="flex items-center gap-2">
        {pending && (
          <Button variant="secondary" onClick={onRetry} disabled={disabled}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {pending.status === 2 ? "Retry revocation" : "Retry activation"}
          </Button>
        )}
        {due && <Button onClick={onPay} disabled={disabled}><Play className="h-4 w-4" aria-hidden="true" /> Pay now</Button>}
        {state?.status === "active" ? (
          <button type="button" onClick={onRevoke} disabled={disabled || !!pending || retryIssue} aria-label={`Revoke ${row.name}`} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-soft text-text-soft hover:text-danger disabled:opacity-50">
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={onRemove} disabled={disabled || !!pending || retryIssue} aria-label={`Remove ${row.name}`} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-soft text-text-soft hover:text-danger disabled:opacity-50">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}
