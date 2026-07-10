"use client";

// Batch send - payroll-style "one input, N requests."
//
// The proposer enters {recipient, amount} rows, reviews one ClearSign
// v2 batch action, then signs one typed proposal. The program verifies
// the exact recipient list + lamports before moving funds.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Download,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { friendlyError } from "@/lib/api/errors";
import {
  isValidSolanaAddress,
  shortAddress,
  type Contact,
} from "@/lib/retail/contacts";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useContacts } from "@/lib/hooks/useContacts";
import { useBatchSend, type BatchSendRow } from "@/lib/hooks/useBatchSend";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { FormField, TextArea, TextInput } from "@/components/retail/FormField";
import { BrandLoader } from "@/components/retail/BrandLoader";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { getProTreasuryRuntime } from "@/lib/pro/treasury";
import { consumeProBatchPrefill } from "@/lib/pro/escrow";
import { formatUsd, quotePerWhole } from "@/lib/retail/priceConversion";

// Hard cap on rows per batch - high enough for real payroll, low
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
      fallback={<div className="min-h-screen" aria-hidden="true" />}
    >
      <BatchSendPage />
    </Suspense>
  );
}

function BatchSendPage() {
  const params = useSearchParams();
  const route = useParams<{ name: string }>();
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const contacts = useContacts();
  const toast = useToast();
  const batch = useBatchSend();
  const runtime = useMemo(() => getProTreasuryRuntime(), []);

  const walletName = useMemo(() => {
    const raw = route?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [route?.name]);
  const budgetUsage = useWalletBudgetUsage(walletName);
  const walletDisplay = toDisplayName(walletName);
  const batchTemplate = params.get("template") === "payroll" ? "payroll" : "batch";
  const prefillId = params.get("prefill")?.trim() ?? "";

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
      const upTo = walletQuery.data.account.intentIndex;
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const firstIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    // See send/page.tsx - skip bootstrap intents (slots 0/1/2).
    return (
      intentsQuery.data.find(
        (it) => it.account !== null && it.account.intentType === IntentType.Custom,
      ) ?? null
    );
  }, [intentsQuery.data]);

  // No spending rule yet → render an explanatory state instead of
  // silently routing to /setup. Same pattern as /members/add and
  // /rules - auto-redirect was disorienting.
  const needsSetup =
    !!walletName &&
    !intentsQuery.isLoading &&
    !walletQuery.isLoading &&
    !!walletQuery.data &&
    firstIntent === null;

  const [stage, setStage] = useState<Stage>("compose");
  const [drafts, setDrafts] = useState<DraftRow[]>(() => [emptyRow()]);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    if (!walletName || !prefillId) return;
    const rows = consumeProBatchPrefill(walletName, prefillId);
    if (rows.length === 0) return;
    setDrafts(
      rows.slice(0, MAX_ROWS).map((row) => ({
        id: emptyRow().id,
        recipient: row.recipient,
        amount: row.amount,
      })),
    );
  }, [walletName, prefillId]);

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
  const batchRisk = useMemo(
    () => buildBatchRiskSummary(totalSol, validRows.length, budgetUsage),
    [totalSol, validRows.length, budgetUsage],
  );

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
  const importCsv = () => {
    const parsed = parseBatchCsv(csvText);
    if (parsed.rows.length === 0) {
      toast.error("No payable rows found", {
        details: "Use columns: name,address,asset,amount,note.",
      });
      return;
    }
    setDrafts(parsed.rows.slice(0, MAX_ROWS));
    setCsvText("");
    toast.success(
      parsed.skipped > 0
        ? `Imported ${parsed.rows.length}, skipped ${parsed.skipped}`
        : `Imported ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"}`,
    );
  };
  const downloadTemplate = () => {
    downloadBatchCsvTemplate(runtime.batchCsvColumns, batchTemplate);
  };

  const canReview = validRows.length === drafts.length && validRows.length > 0;

  const handleSendBatch = async () => {
    if (!firstIntent || !firstIntent.account) {
      toast.error("Couldn't send the batch", {
        details: "This wallet hasn't turned on sending yet.",
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
      // sendBatch swallows row-level errors - anything thrown here is
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
    // Back navigation lives in the global DashboardHeader. Container
    // is centered + capped so the recipient rows stay one readable
    // column on every viewport (a 1200px-wide row of name+amount
    // would make scanning multiple rows much harder).
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <motion.section
        {...motionProps}
        transition={STAGE_TRANSITION}
        className="flex flex-col gap-5"
      >
          {needsSetup && (
            <div className="rounded-card border border-warning/30 bg-warning/[0.06] p-5 shadow-card-rest">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
                Turn on sending
              </p>
              <p className="mt-2 text-sm text-text-strong">
                Batch send needs <strong>{walletDisplay}</strong>&rsquo;s
                sending setup to be in place. Enable sending, then come
                back here.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/app/wallet/${encodeURIComponent(walletName)}/setup`}
                  className={
                    "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
                    "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98]"
                  }
                >
                  Enable sending
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
          {stage === "compose" && (
            <ComposeStage
              walletName={walletName}
              template={batchTemplate}
              csvColumns={runtime.batchCsvColumns}
              csvText={csvText}
              drafts={drafts}
              resolved={resolvedRows}
              contacts={contacts.contacts}
              totalSol={totalSol}
              canReview={canReview}
              onCsvTextChange={setCsvText}
              onImportCsv={importCsv}
              onDownloadTemplate={downloadTemplate}
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
              risk={batchRisk}
              approvalThreshold={firstIntent?.account?.approvalThreshold ?? 1}
              timelockSeconds={firstIntent?.account?.timelockSeconds ?? 0}
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
  );
}

// ─── Compose stage ─────────────────────────────────────────────────

interface ComposeProps {
  walletName: string;
  template: "batch" | "payroll";
  csvColumns: string[];
  csvText: string;
  drafts: DraftRow[];
  resolved: ResolvedRow[];
  contacts: Contact[];
  totalSol: number;
  canReview: boolean;
  onAddRow: () => void;
  onCsvTextChange: (next: string) => void;
  onImportCsv: () => void;
  onDownloadTemplate: () => void;
  onRemoveRow: (id: string) => void;
  onUpdateRow: (id: string, patch: Partial<DraftRow>) => void;
  onReview: () => void;
}

function ComposeStage({
  walletName,
  template,
  csvColumns,
  csvText,
  drafts,
  resolved,
  contacts,
  totalSol,
  canReview,
  onCsvTextChange,
  onImportCsv,
  onDownloadTemplate,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onReview,
}: ComposeProps) {
  const walletDisplay = toDisplayName(walletName);
  const validCount = validRows(resolved);
  const title = template === "payroll" ? "Run payroll" : "Pay many at once";
  const eyebrow = template === "payroll" ? "Payroll" : "Batch send";
  const helper =
    template === "payroll"
      ? "Each team member gets their own request and receipt."
      : "Each recipient gets their own request and receipt.";
  return (
    <div className="flex flex-col gap-5">
      {/* Compact left-aligned header - matches the rest of the
          redesigned app. The Users icon disc moved inline with the
          title so it reads as a section badge, not a giant hero. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"
          >
            <Users className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {eyebrow}
            </p>
            <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight text-text-strong sm:text-3xl">
              {title}
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      <p className="text-sm leading-relaxed text-text-soft">
        {helper}
      </p>

      <details className="group rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-text-strong">
            <Upload className="h-4 w-4 text-accent" aria-hidden="true" />
            Import CSV
          </span>
          <ArrowRight
            className="h-4 w-4 text-text-soft transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 grid gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
            {csvColumns.join(", ")}
          </p>
          <TextArea
            value={csvText}
            onChange={(event) => onCsvTextChange(event.target.value)}
            rows={5}
            placeholder="name,address,asset,amount,note"
            spellCheck={false}
            className="min-h-28 resize-y font-mono text-xs"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              onClick={onDownloadTemplate}
              variant="secondary"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Template
            </Button>
            <Button
              type="button"
              onClick={onImportCsv}
              disabled={!csvText.trim()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Fill rows
            </Button>
          </div>
        </div>
      </details>

      <ul className="flex flex-col gap-3">
        {drafts.map((draft, i) => {
          const status = resolved[i];
          return (
            <RecipientRow
              key={draft.id}
              draft={draft}
              status={status}
              index={i + 1}
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
          "inline-flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-border-soft " +
          "bg-surface-raised px-4 py-3 text-sm font-medium text-text-soft shadow-card-rest " +
          "transition-[border-color,color,transform,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent hover:shadow-card-raised " +
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:transform-none " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add another recipient
        <span className="text-xs text-text-soft/60">
          ({drafts.length}/{MAX_ROWS})
        </span>
      </button>

      {/* Batch total - full card with eyebrow + big numerals + status
          line. Symmetric with the Amount card on /send so the two
          send surfaces feel like the same family. */}
      <section className="flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Batch total
          </span>
          <span className="text-xs text-text-soft">
            <span className="font-medium text-text-strong">{validCount}</span>{" "}
            of <span className="font-medium text-text-strong">{drafts.length}</span>{" "}
            ready
          </span>
        </div>
        <p className="flex items-baseline gap-2">
          <span className="font-numerals text-3xl font-semibold leading-none text-text-strong tabular-nums sm:text-4xl">
            {formatSol(totalSol)}
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft">
            SOL
          </span>
        </p>
      </section>

      <Button size="lg" fullWidth onClick={onReview} disabled={!canReview}>
        Review batch
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

interface RecipientRowProps {
  draft: DraftRow;
  status: ResolvedRow;
  index: number;
  contacts: Contact[];
  canRemove: boolean;
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
}

function RecipientRow({
  draft,
  status,
  index,
  contacts,
  canRemove,
  onChange,
  onRemove,
}: RecipientRowProps) {
  const datalistId = `contacts-${draft.id}`;
  const isValid = status.kind === "valid";
  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        {/* Row index - matches the "row 3 of 8" mental model users
            already have for spreadsheets / payroll lists. */}
        <span
          aria-hidden="true"
          className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas font-numerals text-[11px] font-semibold tabular-nums text-text-soft ring-1 ring-border-soft"
        >
          {index}
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <FormField label="Recipient">
            <TextInput
              value={draft.recipient}
              onChange={(e) => onChange({ recipient: e.target.value })}
              placeholder="Name or wallet address"
              list={datalistId}
              maxLength={64}
              spellCheck={false}
              autoComplete="off"
            />
          </FormField>
          <FormField label="SOL">
            <TextInput
              value={draft.amount}
              onChange={(e) =>
                onChange({ amount: sanitizeAmount(e.target.value) })
              }
              inputMode="decimal"
              placeholder="0.00"
              maxLength={20}
              className="text-right font-numerals tabular-nums sm:w-32"
            />
          </FormField>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove recipient"
            className={
              "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-soft text-text-soft transition-colors duration-base ease-out-soft hover:bg-rose-500/10 hover:text-rose-500 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
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
      {/* Status hints - colour-coded so a long batch reads at a
          glance: green=valid, amber=needs attention. */}
      {(status.kind !== "empty" || isValid) && (
        <div className="ml-9 mt-2">
          {status.kind === "invalid-address" &&
            draft.recipient.trim().length > 0 && (
              <p className="text-xs text-warning">
                Not a contact or a valid Solana address.
              </p>
            )}
          {status.kind === "invalid-amount" &&
            draft.amount.trim().length > 0 && (
              <p className="text-xs text-warning">
                Amount must be greater than zero.
              </p>
            )}
          {isValid && (
            <p className="font-mono text-[11px] text-text-soft">
              Resolves to{" "}
              <span className="text-text-strong">
                {shortAddress(status.destination)}
              </span>
              {" · "}
              <span className="font-numerals tabular-nums text-text-strong">
                {formatSol(Number(status.lamports) / 1_000_000_000)}
              </span>{" "}
              SOL
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ─── Review stage ──────────────────────────────────────────────────

function ReviewStage({
  walletName,
  rows,
  totalSol,
  risk,
  approvalThreshold,
  timelockSeconds,
  onBack,
  onSend,
}: {
  walletName: string;
  rows: ResolvedValid[];
  totalSol: number;
  risk: BatchRiskSummary | null;
  approvalThreshold: number;
  timelockSeconds: number;
  onBack: () => void;
  onSend: () => void;
}) {
  const walletDisplay = toDisplayName(walletName);
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: walletDisplay },
    { label: "Chain", value: "Solana" },
    { label: "Recipients", value: String(rows.length) },
    { label: "Amount", value: `${formatSol(totalSol)} SOL`, emphasis: "amount" },
    { label: "Network fee", value: "Reserved for each request" },
    {
      label: "Approval threshold",
      value: `${approvalThreshold} ${approvalThreshold === 1 ? "approval" : "approvals"}`,
    },
    {
      label: "Timelock",
      value:
        timelockSeconds > 0
          ? `${timelockSeconds} seconds after approval`
          : "Immediately after approval",
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Review batch
        </p>
        <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight text-text-strong sm:text-3xl">
          {rows.length} request{rows.length === 1 ? "" : "s"} from{" "}
          {walletDisplay}
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">
          Each row becomes its own request. Review the recipients before sending.
        </p>
      </header>

      <SignPayloadPreview
        action={`Create ${rows.length} payment ${rows.length === 1 ? "request" : "requests"}`}
        details={details}
        warning={risk?.body}
      />

      <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 px-4 py-3.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas font-numerals text-[11px] font-semibold tabular-nums text-text-soft ring-1 ring-border-soft"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-strong">
                  {r.label}
                </p>
                <p className="truncate font-mono text-[11px] text-text-soft">
                  {shortAddress(r.destination)}
                </p>
              </div>
            </div>
            <span className="shrink-0 inline-flex items-baseline gap-1">
              <span className="font-numerals text-base font-semibold text-text-strong tabular-nums">
                {formatSol(Number(r.lamports) / 1_000_000_000)}
              </span>
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-text-soft">
                SOL
              </span>
            </span>
          </li>
        ))}
      </ul>

      <section className="flex items-center justify-between rounded-card border border-accent/30 bg-accent/[0.06] p-5 shadow-card-rest">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
          Total
        </span>
        <span className="inline-flex items-baseline gap-2">
          <span className="font-numerals text-3xl font-semibold leading-none text-text-strong tabular-nums sm:text-4xl">
            {formatSol(totalSol)}
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft">
            SOL
          </span>
        </span>
      </section>

      {risk ? (
        <section className="rounded-card border border-warning/30 bg-warning/[0.07] p-4 shadow-card-rest">
          <p className="text-sm font-semibold text-text-strong">{risk.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {risk.body}
          </p>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onBack}
          className={
            "inline-flex min-h-tap items-center justify-center rounded-soft border border-border-soft bg-canvas px-4 py-2 text-sm font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          Back to edit
        </button>
        <Button size="lg" onClick={onSend}>
          Send batch
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
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
      <BrandLoader size={40} label="Sending batch" />
      <h1 className="mt-6 font-display text-display-sm leading-[1.05] text-text-strong">
        Creating requests…
      </h1>
      <p className="mt-2 max-w-sm text-base text-text-soft">
        {currentLabel
          ? `Now: ${currentLabel}.`
          : completed === 0
            ? "Getting ready."
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
        {completed} of {total} processed · {succeeded} created · {failed} failed
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
  const walletDisplay = toDisplayName(walletName);
  if (!progress) return null;
  const allSucceeded = progress.failed === 0;
  const heading = allSucceeded
    ? "Requests created"
    : "Batch finished with issues";
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (allSucceeded
                ? "bg-accent text-text-on-accent shadow-accent-rest"
                : "bg-warning/10 text-warning ring-1 ring-warning/30")
            }
          >
            <Check className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {heading}
            </p>
            <p className="mt-0.5 truncate text-xs text-text-soft">
              From {walletDisplay} · awaiting treasury approvals
            </p>
          </div>
        </div>

        <p className="mt-5 inline-flex items-baseline gap-2">
          <span className="font-numerals text-3xl font-semibold leading-none text-text-strong tabular-nums sm:text-4xl">
            {progress.succeeded}
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft">
            of {progress.total} created
          </span>
        </p>
        <p className="mt-1.5 text-sm text-text-soft">
          {allSucceeded
            ? "Every request is ready for approver review."
            : `${progress.failed} row${progress.failed === 1 ? "" : "s"} didn't go through. Review the list below and retry just those.`}
        </p>

        {!allSucceeded && progress.failures.length > 0 && (
          <ul className="mt-5 divide-y divide-border-soft rounded-soft border border-border-soft bg-canvas text-left">
            {progress.failures.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-strong">
                    {f.row.label}
                  </p>
                  <p className="truncate text-xs text-text-soft">
                    {f.message}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-warning">
                  Failed
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button size="lg" fullWidth variant="ghost" onClick={onSendAnother}>
        Send another batch
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
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

interface BatchRiskSummary {
  title: string;
  body: string;
}

function buildBatchRiskSummary(
  totalSol: number,
  rowCount: number,
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>,
): BatchRiskSummary | null {
  if (rowCount <= 0 || totalSol <= 0) return null;
  const quote = quotePerWhole("SOL");
  const pendingUsd = quote ? totalSol * quote.usdPerWhole : 0;
  const solCap = budgetUsage.perChain.find((row) => row.ticker === "SOL");
  if (solCap && solCap.cap !== null && pendingUsd > 0) {
    const after = solCap.spentUsd + pendingUsd;
    if (after > solCap.cap) {
      return {
        title: "Above Solana limit",
        body: `${formatUsd(after)} would be used this week, above the saved ${formatUsd(solCap.cap)} Solana limit.`,
      };
    }
  }

  const weeklyCap = budgetUsage.budget?.weeklyUsd ?? null;
  if (weeklyCap !== null && weeklyCap > 0 && pendingUsd > 0) {
    const after = budgetUsage.spentUsd + pendingUsd;
    if (after > weeklyCap) {
      return {
        title: "Above weekly limit",
        body: `${formatUsd(after)} would be used this week, above the saved ${formatUsd(weeklyCap)} treasury limit.`,
      };
    }
  }

  const velocityCap = budgetUsage.budget?.velocityPerDay ?? null;
  if (velocityCap && budgetUsage.sendsLast24h + rowCount > velocityCap) {
    return {
      title: "Above daily send limit",
      body: `${budgetUsage.sendsLast24h + rowCount} sends would count in the last 24 hours, above the saved limit of ${velocityCap}.`,
    };
  }

  return null;
}

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
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10),
    recipient: "",
    amount: "",
  };
}

function parseBatchCsv(raw: string): { rows: DraftRow[]; skipped: number } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], skipped: 0 };

  const first = parseCsvLine(lines[0] ?? "").map((cell) =>
    cell.trim().toLowerCase(),
  );
  const hasHeader =
    first.includes("amount") ||
    first.includes("address") ||
    first.includes("recipient");
  const header = hasHeader ? first : ["name", "address", "asset", "amount", "note"];
  const body = hasHeader ? lines.slice(1) : lines;
  const indexOf = (...keys: string[]) =>
    keys.map((key) => header.indexOf(key)).find((idx) => idx >= 0) ?? -1;
  const nameIdx = indexOf("name", "recipient", "payee");
  const addressIdx = indexOf("address", "wallet", "wallet_address");
  const assetIdx = indexOf("asset", "token", "ticker");
  const amountIdx = indexOf("amount", "sol");

  const rows: DraftRow[] = [];
  let skipped = 0;

  for (const line of body) {
    const cells = parseCsvLine(line).map((cell) => cell.trim());
    const asset = assetIdx >= 0 ? (cells[assetIdx] ?? "").toUpperCase() : "SOL";
    const recipient =
      (addressIdx >= 0 ? cells[addressIdx] : "") ||
      (nameIdx >= 0 ? cells[nameIdx] : "");
    const amount = amountIdx >= 0 ? cells[amountIdx] ?? "" : "";
    if (!recipient || !amount || (asset && asset !== "SOL")) {
      skipped += 1;
      continue;
    }
    rows.push({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2, 10),
      recipient,
      amount: sanitizeAmount(amount),
    });
  }

  return { rows, skipped };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function downloadBatchCsvTemplate(
  columns: string[],
  template: "batch" | "payroll",
): void {
  if (typeof window === "undefined") return;
  const header = columns.length > 0 ? columns : ["name", "address", "asset", "amount", "note"];
  const sample =
    template === "payroll"
      ? ["Teammate", "SOLANA_ADDRESS", "SOL", "0.25", "Payroll"]
      : ["Vendor", "SOLANA_ADDRESS", "SOL", "0.25", "Invoice"];
  const csv = [header.join(","), sample.slice(0, header.length).join(",")].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clearsig-${template}-template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
