"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Clock3, Play, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import { friendlyError } from "@/lib/api/errors";
import type { ProSchedule } from "@/lib/pro/treasury";
import { useRecurringSchedulesController } from "@/features/treasury/controllers/useRecurringSchedulesController";
import type { RecurringDraft } from "@/features/treasury/domain/recurring";

export default function RecurringPage() {
  const params = useParams<{ name: string }>();
  const walletName = decodeURIComponent(params.name);
  const encoded = encodeURIComponent(walletName);
  const toast = useToast();
  const recurring = useRecurringSchedulesController(walletName);
  const [draft, setDraft] = useState<RecurringDraft>(() => ({
    name: "",
    recipient: "",
    amount: "",
    cadence: "Monthly",
    firstRun: localDateTime(Date.now() + 24 * 60 * 60 * 1000),
    paymentCount: "12",
    note: "",
  }));
  const [submitting, setSubmitting] = useState(false);

  const run = async (task: () => Promise<void>, success: string) => {
    try {
      await task();
      toast.success(success);
    } catch (error) {
      const issue = friendlyError(error, "generic");
      toast.error(issue.title, { details: issue.body });
    }
  };

  const create = async () => {
    if (!draft.name.trim() || !draft.recipient.trim()) {
      toast.error("Add a name and recipient");
      return;
    }
    setSubmitting(true);
    await run(async () => {
      await recurring.configure(draft);
      setDraft((current) => ({ ...current, name: "", recipient: "", amount: "", note: "" }));
    }, "Recurring approval created");
    setSubmitting(false);
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex items-center gap-3 border-b border-border-soft pb-4">
        <Link
          href={`/app/wallet/${encoded}`}
          aria-label="Back to treasury"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-soft text-text-soft hover:border-accent/40 hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <div>
          <p className="text-xs text-text-soft">{walletName}</p>
          <h1 className="text-xl font-semibold text-text-strong">Recurring payments</h1>
        </div>
      </header>

      <section className="grid gap-4 py-5 lg:grid-cols-[0.9fr_1.1fr]">
        <form
          className="grid content-start gap-3 rounded-card border border-border-soft bg-surface-raised p-4"
          onSubmit={(event) => { event.preventDefault(); void create(); }}
        >
          <h2 className="text-sm font-semibold text-text-strong">New schedule</h2>
          <Field label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          <Field label="Recipient" value={draft.recipient} onChange={(recipient) => setDraft({ ...draft, recipient })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="SOL each time" value={draft.amount} inputMode="decimal" onChange={(amount) => setDraft({ ...draft, amount })} />
            <label className="grid gap-1 text-xs text-text-soft">
              Cadence
              <select className={inputClass} value={draft.cadence} onChange={(event) => setDraft({ ...draft, cadence: event.target.value as RecurringDraft["cadence"] })}>
                <option>Weekly</option>
                <option>Monthly</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <label className="grid gap-1 text-xs text-text-soft">
              First payment
              <input aria-label="First payment" className={inputClass} type="datetime-local" value={draft.firstRun} onChange={(event) => setDraft({ ...draft, firstRun: event.target.value })} />
            </label>
            <Field label="Payments" value={draft.paymentCount} inputMode="numeric" onChange={(paymentCount) => setDraft({ ...draft, paymentCount })} />
          </div>
          <Field label="Reason" value={draft.note} onChange={(note) => setDraft({ ...draft, note })} />
          <Button type="submit" fullWidth disabled={submitting || recurring.loading}>
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            {submitting ? "Preparing..." : "Review schedule"}
          </Button>
        </form>

        <section className="min-w-0">
          <div className="flex items-center justify-between border-b border-border-soft pb-3">
            <h2 className="text-sm font-semibold text-text-strong">Schedules</h2>
            <span className="text-xs text-text-soft">{recurring.rows.length}</span>
          </div>
          <div className="divide-y divide-border-soft">
            {recurring.rows.map((row) => (
              <ScheduleRow
                key={row.id}
                row={row}
                state={recurring.states[row.id] ?? null}
                busy={recurring.busyId === row.id}
                onRetry={() => run(() => recurring.retry(row), "Schedule activated")}
                onPay={() => run(() => recurring.pay(row), "Payment executed")}
                onRevoke={() => run(() => recurring.revoke(row), "Revocation approval created")}
                onRemove={() => recurring.remove(row.id)}
              />
            ))}
            {recurring.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-text-soft">No recurring payments.</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function ScheduleRow({ row, state, busy, onRetry, onPay, onRevoke, onRemove }: {
  row: ProSchedule;
  state: { status: "active" | "revoked" | "complete"; nextExecutionAt: number; remainingPayments: number; executedPayments: number } | null;
  busy: boolean;
  onRetry: () => void;
  onPay: () => void;
  onRevoke: () => void;
  onRemove: () => void;
}) {
  const due = state?.status === "active" && state.nextExecutionAt <= Math.floor(Date.now() / 1000);
  return (
    <article className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-text-strong">{row.name}</h3>
          <span className="text-xs capitalize text-accent">{state?.status ?? "awaiting approval"}</span>
        </div>
        <p className="mt-1 truncate text-xs text-text-soft">{row.amount} SOL · {row.cadence} · {row.address}</p>
        {state ? (
          <p className="mt-1 text-xs text-text-soft">{state.executedPayments} paid · {state.remainingPayments} remaining</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {!state && row.proposalAddress ? (
          <Button variant="secondary" onClick={onRetry} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry
          </Button>
        ) : null}
        {due ? (
          <Button onClick={onPay} disabled={busy}>
            <Play className="h-4 w-4" aria-hidden="true" /> Pay now
          </Button>
        ) : null}
        {state?.status === "active" ? (
          <button type="button" onClick={onRevoke} disabled={busy} aria-label={`Revoke ${row.name}`} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-soft text-text-soft hover:text-danger">
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={onRemove} aria-label={`Remove ${row.name}`} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-soft text-text-soft hover:text-danger">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

function Field({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal" | "numeric" }) {
  return (
    <label className="grid gap-1 text-xs text-text-soft">
      {label}
      <input aria-label={label} className={inputClass} value={value} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

const inputClass = "min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none focus:border-accent/50";

function localDateTime(value: number): string {
  const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
