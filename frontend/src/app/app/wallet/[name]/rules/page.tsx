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

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clock,
  Lock,
  Plus,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType, type IntentAccount } from "@/lib/msig";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { friendlyIntentLabel } from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";
import { encryptStatus } from "@/lib/encrypt/client";

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

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Spending rules
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          How {toDisplayName(name)} spends
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
}

function RuleCard({ intent, delay, reduce }: RuleCardProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };

  const label = friendlyIntentLabel(intent);
  const isImmediate = intent.timelockSeconds === 0;
  const timelockLabel = isImmediate
    ? "Sends right away"
    : `Waits ${formatDuration(intent.timelockSeconds)}`;
  const approverCount = intent.approvers.length;

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
