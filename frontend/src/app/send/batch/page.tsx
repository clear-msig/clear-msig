"use client";

// Batch send — payroll-style "one input, N requests."
//
// The proposer enters {recipient, amount} rows, taps "Send batch",
// and signs once per row in their wallet popup. Each row becomes its
// own SolTransfer proposal under the wallet's first spending rule.
// Rows are grouped under one batch_id locally so the dashboard can
// render them as a single line ("Payroll • 50 requests") instead of
// 50 near-identical rows.
//
// Why N proposals: the on-chain SolTransfer template fires a single
// CPI per execution. A program-level batch-intent type (one signature
// per actor for the whole bundle) is on the roadmap; this is the v1
// that ships against today's program with no contract changes.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { friendlyError } from "@/lib/api/errors";
import {
  isValidSolanaAddress,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";
import { useContacts } from "@/lib/hooks/useContacts";
import { useBatchSend, type BatchSendRow } from "@/lib/hooks/useBatchSend";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";

// Hard cap on rows per batch — high enough for real payroll, low
// enough to prevent runaway sign-prompt loops.
const MAX_ROWS = 50;
const STAGE_TRANSITION = {
  duration: 0.35,
  ease: [0.22, 1, 0.36, 1] as const,
};

type Stage = "compose" | "review" | "sending" | "done";

interface DraftRow {
  id: string;
  recipient: string;
  amount: string;
}

export default function BatchSendPageWrapper() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-canvas" aria-hidden="true" />}
    >
      <BatchSendPage />
    </Suspense>
  );
}

function BatchSendPage() {
  const router = useRouter();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const contacts = useContacts();
  const toast = useToast();
  const batch = useBatchSend();

  const walletName = params?.get("wallet")?.trim() || "";

  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      const upTo = walletQuery.data.account.intentIndex - 1;
      if (upTo < 0) return [];
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return intentsQuery.data.find((it) => it.account !== null) ?? null;
  }, [intentsQuery.data]);

  // Bounce to setup if there's no spending rule on the wallet — same
  // safety net the single-send page uses.
  useEffect(() => {
    if (!walletName) return;
    if (intentsQuery.isLoading || walletQuery.isLoading) return;
    if (!walletQuery.data) return;
    if (firstIntent === null) {
      router.replace(`/app/wallet/${encodeURIComponent(walletName)}/setup`);
    }
  }, [
    walletName,
    intentsQuery.isLoading,
    walletQuery.isLoading,
    walletQuery.data,
    firstIntent,
    router,
  ]);

  const [stage, setStage] = useState<Stage>("compose");
  const [drafts, setDrafts] = useState<DraftRow[]>(() => [emptyRow()]);

  const resolvedRows = useMemo(
    () => drafts.map((d) => resolveRow(d, contacts.contacts)),
    [drafts, contacts.contacts],
  );
  const validRows = useMemo(
    () => resolvedRows.filter((r) => r.kind === "valid"),
    [resolvedRows],
  );
  const totalLamports = useMemo(
    () =>
      validRows.reduce((sum, r) => sum + Number(r.lamports), 0),
    [validRows],
  );
  const totalSol = totalLamports / 1_000_000_000;

  const addRow = () => {
    if (drafts.length >= MAX_ROWS) return;
    setDrafts((rows) => [...rows, emptyRow()]);
  };
  const removeRow = (id: string) => {
    setDrafts((rows) =>
      rows.length === 1 ? [emptyRow()] : rows.filter((r) => r.id !== id),
    );
  };
  const updateRow = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  const canReview = validRows.length === drafts.length && validRows.length > 0;

  const handleSendBatch = async () => {
    if (!firstIntent || !firstIntent.account) {
      toast.error("Couldn't send the batch", {
        details: "This wallet hasn't set up a spending rule yet.",
      });
      return;
    }
    const rows: BatchSendRow[] = validRows.map((r) => ({
      label: r.label,
      destination: r.destination,
      lamports: r.lamports,
    }));
    // Clear any leftover state from a previous batch before flipping
    // stages so the "sending" view never shows stale numbers.
    batch.reset();
    setStage("sending");
    try {
      const result = await batch.sendBatch({
        walletName,
        intentIndex: firstIntent.account.intentIndex,
        rows,
      });
      setStage("done");
      if (result.failed > 0 && result.succeeded === 0) {
        toast.error("Couldn't send the batch", {
          details:
            "Every row failed. Check the per-row notes and retry just those.",
        });
      }
    } catch (err) {
      // sendBatch swallows row-level errors — anything thrown here is
      // a setup-level problem (wallet disconnected mid-flight, etc.).
      console.error("[batch-send]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      setStage("compose");
    }
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <header className="relative z-10 flex items-center justify-between px-gutter pt-6">
        <Link
          href={
            walletName
              ? `/app/wallet/${encodeURIComponent(walletName)}`
              : "/app/wallet"
          }
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {walletName || "Wallets"}
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={STAGE_TRANSITION}
          className="w-full max-w-xl"
        >
          {stage === "compose" && (
            <ComposeStage
              walletName={walletName}
              drafts={drafts}
              resolved={resolvedRows}
              contacts={contacts.contacts}
              totalSol={totalSol}
              canReview={canReview}
              onAddRow={addRow}
              onRemoveRow={removeRow}
              onUpdateRow={updateRow}
              onReview={() => setStage("review")}
            />
          )}
          {stage === "review" && (
            <ReviewStage
              walletName={walletName}
              rows={validRows}
              totalSol={totalSol}
              onBack={() => setStage("compose")}
              onSend={handleSendBatch}
            />
          )}
          {stage === "sending" && (
            <SendingStage
              progress={batch.progress}
              onCancel={batch.cancel}
              fallbackTotal={validRows.length}
            />
          )}
          {stage === "done" && batch.progress && (
            <DoneStage
              walletName={walletName}
              progress={batch.progress}
              onSendAnother={() => {
                batch.reset();
                setDrafts([emptyRow()]);
                setStage("compose");
              }}
            />
          )}
        </motion.section>
      </div>
    </main>
  );
}

// ─── Compose stage ─────────────────────────────────────────────────

interface ComposeProps {
  walletName: string;
  drafts: DraftRow[];
  resolved: ResolvedRow[];
  contacts: Contact[];
  totalSol: number;
  canReview: boolean;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onUpdateRow: (id: string, patch: Partial<DraftRow>) => void;
  onReview: () => void;
}

function ComposeStage({
  walletName,
  drafts,
  resolved,
  contacts,
  totalSol,
  canReview,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onReview,
}: ComposeProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Users className="h-7 w-7" strokeWidth={1.75} />
      </div>
      <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
        Send a batch from {walletName}
      </h1>
      <p className="mt-3 max-w-sm text-base text-text-soft">
        Pay many people at once — payroll, splits, an event. Each row
        becomes its own request your friends can approve together.
      </p>

      <ul className="mt-8 flex w-full flex-col gap-3 text-left">
        {drafts.map((draft, i) => {
          const status = resolved[i];
          return (
            <RecipientRow
              key={draft.id}
              draft={draft}
              status={status}
              contacts={contacts}
              canRemove={drafts.length > 1}
              onChange={(patch) => onUpdateRow(draft.id, patch)}
              onRemove={() => onRemoveRow(draft.id)}
            />
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onAddRow}
        disabled={drafts.length >= MAX_ROWS}
        className={
          "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-border-soft " +
          "bg-canvas px-4 py-3 text-sm font-medium text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
          "disabled:cursor-not-allowed disabled:opacity-40 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add another recipient
        <span className="text-xs text-text-soft/60">
          ({drafts.length}/{MAX_ROWS})
        </span>
      </button>

      <div className="mt-6 w-full rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            Batch total
          </span>
          <span className="font-display text-display-xs text-text-strong">
            {formatSol(totalSol)}{" "}
            <span className="text-text-soft">SOL</span>
          </span>
        </div>
        <p className="mt-1 text-right text-xs text-text-soft">
          {validRows(resolved)} of {drafts.length} rows ready
        </p>
      </div>

      <Button
        size="lg"
        fullWidth
        className="mt-6"
        onClick={onReview}
        disabled={!canReview}
      >
        Review batch
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

interface RecipientRowProps {
  draft: DraftRow;
  status: ResolvedRow;
  contacts: Contact[];
  canRemove: boolean;
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
}

function RecipientRow({
  draft,
  status,
  contacts,
  canRemove,
  onChange,
  onRemove,
}: RecipientRowProps) {
  const datalistId = `contacts-${draft.id}`;
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-text-soft">
          To
        </span>
        <input
          value={draft.recipient}
          onChange={(e) => onChange({ recipient: e.target.value })}
          placeholder="Name or wallet address"
          list={datalistId}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
          className={
            "flex-1 bg-transparent py-1.5 text-base text-text-strong outline-none " +
            "placeholder:text-text-soft/60"
          }
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove recipient"
            className={
              "rounded-soft p-1.5 text-text-soft transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-danger " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <datalist id={datalistId}>
        {contacts.map((c) => (
          <option key={c.address} value={c.name} />
        ))}
      </datalist>
      <div className="h-px bg-border-soft" />
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-text-soft">
          SOL
        </span>
        <input
          value={draft.amount}
          onChange={(e) =>
            onChange({ amount: sanitizeAmount(e.target.value) })
          }
          inputMode="decimal"
          placeholder="0.00"
          maxLength={20}
          className={
            "flex-1 bg-transparent py-1.5 text-base text-text-strong outline-none " +
            "placeholder:text-text-soft/60"
          }
        />
      </div>
      {status.kind === "invalid-address" && draft.recipient.trim().length > 0 && (
        <p className="text-xs text-warning">
          That doesn&rsquo;t look like a contact or a valid Solana address.
        </p>
      )}
      {status.kind === "invalid-amount" && draft.amount.trim().length > 0 && (
        <p className="text-xs text-warning">
          Amount must be greater than zero.
        </p>
      )}
      {status.kind === "valid" && (
        <p className="text-xs text-text-soft">
          Resolves to {shortAddress(status.destination)} ·{" "}
          {formatSol(Number(status.lamports) / 1_000_000_000)} SOL
        </p>
      )}
    </li>
  );
}

// ─── Review stage ──────────────────────────────────────────────────

function ReviewStage({
  walletName,
  rows,
  totalSol,
  onBack,
  onSend,
}: {
  walletName: string;
  rows: ResolvedValid[];
  totalSol: number;
  onBack: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
        Send {rows.length} request{rows.length === 1 ? "" : "s"} from{" "}
        {walletName}?
      </h1>
      <p className="mt-3 max-w-sm text-base text-text-soft">
        Each row becomes its own request. Your wallet will pop up{" "}
        <span className="font-medium text-text-strong">
          {rows.length} time{rows.length === 1 ? "" : "s"}
        </span>{" "}
        — once per recipient — so you can confirm each one.
      </p>

      <ul className="mt-6 w-full divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised text-left shadow-card-rest">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-strong">
                {r.label}
              </p>
              <p className="truncate font-mono text-xs text-text-soft">
                {shortAddress(r.destination)}
              </p>
            </div>
            <span className="shrink-0 font-display text-base text-text-strong">
              {formatSol(Number(r.lamports) / 1_000_000_000)}{" "}
              <span className="text-text-soft">SOL</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex w-full items-baseline justify-between rounded-card border border-accent/30 bg-accent/5 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
          Total
        </span>
        <span className="font-display text-display-xs text-text-strong">
          {formatSol(totalSol)}{" "}
          <span className="text-text-soft">SOL</span>
        </span>
      </div>

      <Button size="lg" fullWidth className="mt-6" onClick={onSend}>
        Send batch
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="mt-3 text-sm text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
      >
        Back to edit
      </button>
    </div>
  );
}

// ─── Sending stage ─────────────────────────────────────────────────

function SendingStage({
  progress,
  onCancel,
  fallbackTotal,
}: {
  progress: ReturnType<typeof useBatchSend>["progress"];
  onCancel: () => void;
  fallbackTotal: number;
}) {
  // The hook calls `setProgress` synchronously inside `sendBatch`,
  // but that state lands one render after `setStage("sending")`. Show
  // a generic spinner for the brief gap so the screen never goes
  // blank between stages.
  const total = progress?.total ?? fallbackTotal;
  const succeeded = progress?.succeeded ?? 0;
  const failed = progress?.failed ?? 0;
  const currentLabel = progress?.currentLabel;
  const completed = succeeded + failed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex flex-col items-center text-center">
      <Loader2
        className="h-10 w-10 animate-spin text-accent"
        aria-hidden="true"
      />
      <h1 className="mt-6 font-display text-display-sm leading-[1.05] text-text-strong">
        Sending batch…
      </h1>
      <p className="mt-2 max-w-sm text-base text-text-soft">
        {currentLabel
          ? `Now: ${currentLabel}. Confirm each in your wallet popup.`
          : completed === 0
            ? "Getting ready — your wallet will pop up shortly."
            : "Wrapping up the last few."}
      </p>

      <div className="mt-6 w-full overflow-hidden rounded-full bg-border-soft">
        <div
          role="progressbar"
          aria-valuenow={completed}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Batch progress"
          style={{ width: `${pct}%` }}
          className="h-2 bg-accent transition-[width] duration-base ease-out-soft"
        />
      </div>
      <p className="mt-2 text-sm text-text-soft">
        {completed} of {total} processed · {succeeded} sent · {failed} failed
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="mt-6 text-sm text-text-soft transition-colors duration-base ease-out-soft hover:text-danger"
      >
        Cancel remaining
      </button>
    </div>
  );
}

// ─── Done stage ────────────────────────────────────────────────────

function DoneStage({
  walletName,
  progress,
  onSendAnother,
}: {
  walletName: string;
  progress: ReturnType<typeof useBatchSend>["progress"];
  onSendAnother: () => void;
}) {
  if (!progress) return null;
  const allSucceeded = progress.failed === 0;
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={
          "flex h-16 w-16 items-center justify-center rounded-full " +
          (allSucceeded
            ? "bg-accent text-white shadow-accent-rest"
            : "bg-warning/10 text-warning")
        }
      >
        <Check className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" />
      </div>
      <h1 className="mt-6 font-display text-display-sm leading-[1.05] text-text-strong">
        {allSucceeded
          ? `Sent ${progress.succeeded} of ${progress.total}`
          : `Sent ${progress.succeeded} of ${progress.total} — ${progress.failed} need another look`}
      </h1>
      <p className="mt-2 max-w-sm text-base text-text-soft">
        {allSucceeded
          ? `Each request is waiting for your friends to approve. Track them on ${walletName}'s page.`
          : "Some rows didn't go through. Review the list below, then retry just those."}
      </p>

      {!allSucceeded && progress.failures.length > 0 && (
        <ul className="mt-6 w-full divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised text-left shadow-card-rest">
          {progress.failures.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-strong">
                  {f.row.label}
                </p>
                <p className="truncate text-xs text-text-soft">{f.message}</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-warning">
                Failed
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row">
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}`}
          className="flex-1"
        >
          <Button size="lg" fullWidth>
            Back to {walletName}
          </Button>
        </Link>
        <Button
          size="lg"
          variant="ghost"
          fullWidth
          onClick={onSendAnother}
          className="flex-1"
        >
          Send another batch
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

interface ResolvedValid {
  kind: "valid";
  label: string;
  destination: string;
  lamports: string;
}
type ResolvedRow =
  | ResolvedValid
  | { kind: "empty" }
  | { kind: "invalid-address" }
  | { kind: "invalid-amount" };

function resolveRow(draft: DraftRow, contacts: Contact[]): ResolvedRow {
  const recipientRaw = draft.recipient.trim();
  const amountRaw = draft.amount.trim();
  if (recipientRaw.length === 0 && amountRaw.length === 0) return { kind: "empty" };

  const contact = contacts.find(
    (c) => c.name.toLowerCase() === recipientRaw.toLowerCase(),
  );
  const destination = contact
    ? contact.address
    : isValidSolanaAddress(recipientRaw)
      ? recipientRaw
      : null;
  if (!destination) return { kind: "invalid-address" };

  const sol = Number(amountRaw);
  if (!isFinite(sol) || sol <= 0) return { kind: "invalid-amount" };
  const lamports = Math.round(sol * 1_000_000_000).toString();
  const label = contact ? contact.name : shortAddress(destination);

  return { kind: "valid", label, destination, lamports };
}

function validRows(resolved: ResolvedRow[]): number {
  return resolved.filter((r) => r.kind === "valid").length;
}

function emptyRow(): DraftRow {
  return {
    id: Math.random().toString(36).slice(2, 10),
    recipient: "",
    amount: "",
  };
}

function sanitizeAmount(raw: string): string {
  const stripped = raw.replace(/[^\d.]/g, "");
  const [whole = "", frac] = stripped.split(".");
  const w = whole.slice(0, 12);
  return frac === undefined ? w : `${w}.${frac.slice(0, 4)}`;
}

function formatSol(n: number): string {
  if (!isFinite(n) || n === 0) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}
