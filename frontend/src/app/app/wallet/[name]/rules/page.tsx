"use client";

// Spending rules — all the on-chain intents this wallet has.
//
// Each spending rule answers: who can use it, how many of them have to
// approve, and how long the wait is between approval and execution.
// Today's program lets each wallet hold N intents; setup creates one,
// and this page shows them with retail framing so users (and future
// expanded UIs) can browse / add more.
//
// Edit + remove require signed mutations on chain — out of scope for
// this list view. The "Add another rule" CTA sends the user back
// through the existing /setup flow.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Clock,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType, type IntentAccount } from "@/lib/msig";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";
import { friendlyIntentLabel } from "@/lib/retail/labels";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  templateFileForChainKind,
  useUpdateTimelock,
} from "@/lib/hooks/useUpdateTimelock";
import { useToast } from "@/components/ui/Toast";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

export default function RulesPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const { connection } = useConnection();
  const reduce = useReducedMotion();

  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
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

  const liveIntents = useMemo(
    () =>
      (intentsQuery.data ?? [])
        .map((it) => it.account)
        // Only the user-facing rules. Bootstrap AddIntent /
        // RemoveIntent / UpdateIntent at slots 0/1/2 are program
        // plumbing, not "spending rules" in retail terms.
        .filter(
          (a): a is IntentAccount =>
            a !== null && a.intentType === IntentType.Custom,
        ),
    [intentsQuery.data],
  );

  // No rules yet → render an empty-state card with a clear CTA
  // instead of silently bouncing the user. The auto-redirect was
  // disorienting ("I clicked Rules but ended up on Setup with no
  // breadcrumb of why").
  const needsSetup =
    !intentsQuery.isLoading &&
    !walletQuery.isLoading &&
    !!walletQuery.data &&
    liveIntents.length === 0;

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const status = encryptStatus();

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Spending rules" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip — see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
      >
        <span aria-hidden="true" className="mx-auto block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Spending rules
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          How <span className="text-accent">{toHeadingName(name)}</span> spends
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          Each rule is one way money can leave this wallet. They
          decide who can use it, how many friends approve, and how
          long the wait is before it ships.
        </p>
        <Link
          href="/privacy"
          className={
            "mt-4 inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          Encryption-ready · pre-alpha
        </Link>
      </motion.section>

      {intentsQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <RuleCardSkeleton />
          <RuleCardSkeleton />
        </div>
      ) : needsSetup ? (
        <div className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest">
          <p className="text-sm text-text-soft">
            No spending rule yet. Set one up below to enable sending.
            You&rsquo;ll do this once per wallet.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {liveIntents.map((intent, i) => (
            <RuleCard
              key={`${intent.intentIndex}`}
              intent={intent}
              delay={i * 0.04}
              reduce={!!reduce}
              walletName={name}
            />
          ))}
        </ul>
      )}

      <Link
        href={`/app/wallet/${encodeURIComponent(name)}/setup`}
        className={
          "group inline-flex w-full items-center justify-center gap-2 self-start rounded-card border border-dashed border-border-soft bg-surface-raised px-5 py-4 text-sm font-medium text-text-strong shadow-card-rest " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add another rule
      </Link>

      {!status.live && (
        <p className="px-1 text-xs text-text-soft">
          Each rule&rsquo;s details are stored on chain.{" "}
          <Link
            href="/privacy"
            className="font-medium text-accent transition-colors duration-base ease-out-soft hover:text-accent-hover"
          >
            How privacy works
          </Link>
          .
        </p>
      )}
    </div>
  );
}

// ─── Rule card ─────────────────────────────────────────────────────

interface RuleCardProps {
  intent: IntentAccount;
  delay: number;
  reduce: boolean;
  walletName: string;
}

function RuleCard({ intent, delay, reduce, walletName }: RuleCardProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };

  const label = friendlyIntentLabel(intent);
  const isImmediate = intent.timelockSeconds === 0;
  const timelockLabel = isImmediate
    ? "Sends right away"
    : `Waits ${formatDuration(intent.timelockSeconds)}`;
  const approverCount = intent.approvers.length;

  // Custom intents (chain_kind on a real spending rule) are
  // editable; meta-intents (AddIntent / RemoveIntent / UpdateIntent)
  // run the program's policy itself and shouldn't have their
  // timelock manipulated. The on-chain UpdateIntent encoder also
  // expects a valid template file path, which only the chain
  // templates have.
  const editable =
    intent.intentType === IntentType.Custom &&
    (intent.chainKind === 0 ||
      intent.chainKind === 1 ||
      intent.chainKind === 4);

  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg text-text-strong">{label}</p>
          <p className="mt-0.5 text-xs text-text-soft">
            Rule #{intent.intentIndex + 1}
          </p>
        </div>
        {editable && (
          <TimelockEditTrigger
            walletName={walletName}
            intentIndex={intent.intentIndex}
            currentSeconds={intent.timelockSeconds}
            chainKind={intent.chainKind}
          />
        )}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Fact
          Icon={isImmediate ? Zap : Clock}
          label="Timing"
          value={timelockLabel}
        />
        <Fact
          Icon={ShieldCheck}
          label="Approvals"
          value={`${intent.approvalThreshold} of ${approverCount}`}
        />
        <Fact
          Icon={Users}
          label="Members"
          value={`${approverCount} can approve`}
        />
      </dl>
    </motion.li>
  );
}

function Fact({
  Icon,
  label,
  value,
}: {
  Icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-text-soft">
        <Icon className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
        {label}
      </dt>
      <dd className="mt-1 text-sm text-text-strong">{value}</dd>
    </div>
  );
}

function RuleCardSkeleton() {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-border-soft" />
        <div className="flex-1 space-y-1.5">
          <div className="h-5 w-1/3 animate-pulse rounded bg-border-soft" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-border-soft" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-8 animate-pulse rounded bg-border-soft" />
        <div className="h-8 animate-pulse rounded bg-border-soft" />
        <div className="h-8 animate-pulse rounded bg-border-soft" />
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(seconds / 86400);
  return `${days}d`;
}

// ─── Timelock edit (Tier-5 #37) ─────────────────────────────────

interface TimelockEditTriggerProps {
  walletName: string;
  intentIndex: number;
  currentSeconds: number;
  chainKind: number;
}

const TIMELOCK_PRESETS: ReadonlyArray<{ label: string; seconds: number }> = [
  { label: "Send right away", seconds: 0 },
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

function TimelockEditTrigger({
  walletName,
  intentIndex,
  currentSeconds,
  chainKind,
}: TimelockEditTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Change timelock"
        title="Change timelock"
        className={
          "shrink-0 rounded-soft p-1.5 text-text-soft transition-colors duration-base ease-out-soft " +
          "hover:bg-canvas hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        }
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <TimelockEditModal
            walletName={walletName}
            intentIndex={intentIndex}
            currentSeconds={currentSeconds}
            chainKind={chainKind}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

interface TimelockEditModalProps {
  walletName: string;
  intentIndex: number;
  currentSeconds: number;
  chainKind: number;
  onClose: () => void;
}

function TimelockEditModal({
  walletName,
  intentIndex,
  currentSeconds,
  chainKind,
  onClose,
}: TimelockEditModalProps) {
  const [next, setNext] = useState<number>(currentSeconds);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState(String(currentSeconds));
  const update = useUpdateTimelock();
  const toast = useToast();
  // Freeze the page underneath so iOS Safari doesn't scroll the
  // Rules page behind the dialog while the user is interacting
  // with timelock presets.
  useBodyScrollLock(true);

  // Pick a preset if the current value matches one. Otherwise let
  // the user fall through to custom-seconds input.
  const presetMatch = TIMELOCK_PRESETS.find((p) => p.seconds === currentSeconds);
  const showingCustom = customMode || !presetMatch;

  const apply = async () => {
    const value = customMode
      ? Math.max(0, parseInt(customText, 10) || 0)
      : next;
    if (value === currentSeconds) {
      onClose();
      return;
    }
    try {
      const templateFile = templateFileForChainKind(chainKind);
      await update.mutateAsync({
        walletName,
        intentIndex,
        newTimelockSeconds: value,
        templateFile,
      });
      toast.success(
        value === 0
          ? "Timelock removed — sends ship right away after approval"
          : `Timelock set to ${formatDuration(value)}`,
      );
      onClose();
    } catch (err) {
      console.error("[update-timelock]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update timelock",
      );
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[200] bg-text-strong/40 backdrop-blur-sm"
        onClick={() => !update.isPending && onClose()}
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Change timelock"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="fixed left-1/2 top-1/2 z-[201] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-raised"
      >
        <button
          type="button"
          onClick={() => !update.isPending && onClose()}
          className="absolute right-3 top-3 rounded-soft p-1 text-text-soft transition-colors hover:bg-canvas hover:text-text-strong"
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Clock className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-display-xs leading-tight text-text-strong">
          Change timelock
        </h2>
        <p className="mt-2 text-xs text-text-soft">
          Currently waits{" "}
          <span className="font-medium text-text-strong">
            {currentSeconds === 0 ? "0s (ships immediately)" : formatDuration(currentSeconds)}
          </span>{" "}
          between approval and execute. Updating runs an UpdateIntent
          on chain — you&rsquo;ll sign 1–2 wallet popups.
        </p>

        {!showingCustom && (
          <div className="mt-4 grid grid-cols-1 gap-1.5">
            {TIMELOCK_PRESETS.map((p) => {
              const active = next === p.seconds;
              return (
                <button
                  key={p.seconds}
                  type="button"
                  onClick={() => setNext(p.seconds)}
                  disabled={update.isPending}
                  className={
                    "rounded-soft border px-3 py-2 text-left text-xs transition-[border-color,background-color] duration-base ease-out-soft " +
                    (active
                      ? "border-accent bg-accent/[0.08] text-text-strong"
                      : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
                  }
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="ml-2 text-[10px] tabular-nums text-text-soft">
                    {p.seconds}s
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              disabled={update.isPending}
              className="rounded-soft border border-dashed border-border-soft px-3 py-2 text-left text-xs text-text-soft transition-colors hover:border-accent hover:text-accent"
            >
              Custom number of seconds
            </button>
          </div>
        )}

        {showingCustom && (
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Seconds
            </label>
            <input
              type="number"
              min={0}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              disabled={update.isPending}
              autoFocus
              className={
                "rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft focus:border-accent focus:shadow-accent-rest"
              }
            />
            {!presetMatch && !customMode ? null : (
              <button
                type="button"
                onClick={() => setCustomMode(false)}
                className="self-start text-[11px] text-text-soft hover:text-text-strong"
              >
                Use a preset instead
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="text-[11px] text-text-soft hover:text-text-strong disabled:opacity-50"
          >
            Cancel
          </button>
          <Button size="md" onClick={() => void apply()} disabled={update.isPending}>
            {update.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving
              </>
            ) : (
              <>
                <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                Save
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </>
  );
}
