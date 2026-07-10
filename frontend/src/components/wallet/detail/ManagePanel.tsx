"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  Gauge,
  Network,
  Repeat2,
  Send,
  ShieldCheck,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import type { ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import {
  getBudget,
  type WalletBudget,
} from "@/lib/retail/spendingBudget";
import type { TxAttempt } from "@/lib/retail/txLog";
import type { WalletProductSurface } from "@/lib/productWorkspace";
import {
  ActionGroup,
  ActionRow,
} from "@/components/wallet/detail/ManageActionPrimitives";

const ProTreasuryPanel = dynamic(
  () =>
    import("@/components/wallet/detail/ProTreasuryPanel").then(
      (mod) => mod.ProTreasuryPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-40 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
    ),
  },
);

export interface ManagePanelProps {
  name: string;
  productSurface: WalletProductSurface | null;
  actionRows: ActionNeededRow[];
  activityRows: RecentActivityRow[];
  attempts: TxAttempt[];
  hasIntents: boolean | null;
  reduce: boolean;
}

export function ManagePanel({
  name,
  productSurface,
  actionRows,
  activityRows,
  attempts,
  hasIntents,
  reduce,
}: ManagePanelProps) {
  return (
    <div
      id="wallet-tab-panel-manage"
      role="tabpanel"
      aria-labelledby="wallet-tab-manage"
      className="flex flex-col gap-4"
    >
      {productSurface === "pro" ? (
        <ProTreasuryPanel
          name={name}
          actionRows={actionRows}
          activityRows={activityRows}
          attempts={attempts}
          reduce={reduce}
        />
      ) : null}
      {productSurface !== "pro" || hasIntents === false ? (
        <Actions
          name={name}
          productSurface={productSurface}
          hasIntents={hasIntents}
          reduce={reduce}
        />
      ) : null}
    </div>
  );
}

function Actions({
  name,
  productSurface,
  hasIntents,
  reduce,
}: {
  name: string;
  productSurface: WalletProductSurface | null;
  /// null while loading, false once we've confirmed no intents exist.
  hasIntents: boolean | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(name);
  const sendingReady = hasIntents !== false;
  const groups = manageActionGroups(productSurface, encoded);
  const isPersonal = productSurface === "personal";
  const showSetupPrompt =
    !sendingReady &&
    (isPersonal ||
      productSurface === "pro" ||
      productSurface === null);

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-5"
    >
      {showSetupPrompt && (
        <Link
          href={`/app/wallet/${encoded}/setup`}
          className={
            "group flex items-center gap-3 rounded-card border border-accent/30 bg-accent/[0.05] p-5 shadow-card-rest " +
            "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card-raised " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Send className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-strong">
              Turn on sending
            </p>
            <p className="mt-0.5 text-xs text-text-soft">
              Turn it on once. Every send after that uses a readable receipt.
            </p>
          </div>
          <ArrowRight
            className="h-4 w-4 shrink-0 text-accent transition-transform duration-base group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      )}

      {isPersonal ? <PersonalSafetyPanel walletName={name} /> : null}

      {groups.map((group) => (
        <ActionGroup
          key={group.label}
          label={group.label}
          description={group.description}
        >
          {group.rows.map((row) => (
            <ActionRow
              key={row.href}
              href={row.href}
              icon={row.icon}
              title={row.title}
              body={row.body}
            />
          ))}
        </ActionGroup>
      ))}
    </motion.div>
  );
}

type ManageActionGroup = {
  label: string;
  description?: string;
  rows: Array<{
    href: string;
    icon: LucideIcon;
    title: string;
    body?: string;
  }>;
};

function PersonalSafetyPanel({ walletName }: { walletName: string }) {
  const encoded = encodeURIComponent(walletName);
  const [budget, setBudget] = useState<WalletBudget | null>(() =>
    getBudget(walletName),
  );

  useEffect(() => {
    const refresh = () => setBudget(getBudget(walletName));
    refresh();
    window.addEventListener("clear:spending-budget-changed", refresh);
    return () => {
      window.removeEventListener("clear:spending-budget-changed", refresh);
    };
  }, [walletName]);

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
        Protection
      </p>

      <Link
        href={`/app/wallet/${encoded}/budget`}
        className="group mt-3 flex min-h-14 items-center gap-3 border-t border-border-soft pt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Gauge className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-strong">
            Spending limits
          </span>
          <span className="block truncate text-xs text-text-soft">
            {spendingLimitSummary(budget)}
          </span>
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-soft transition group-hover:translate-x-0.5 group-hover:text-accent" />
      </Link>
    </section>
  );
}

function spendingLimitSummary(budget: WalletBudget | null): string {
  if (!budget) return "No limits set";
  const active: string[] = [];
  if (budget.weeklyUsd && budget.weeklyUsd > 0) {
    active.push(`$${budget.weeklyUsd.toLocaleString("en-US")} / week`);
  }
  const chainCaps = Object.values(budget.perChainUsd ?? {}).filter(
    (value) => typeof value === "number" && value > 0,
  ).length;
  if (chainCaps > 0) active.push(`${chainCaps} chain ${chainCaps === 1 ? "cap" : "caps"}`);
  if (budget.velocityPerDay && budget.velocityPerDay > 0) {
    active.push(`${budget.velocityPerDay} sends / day`);
  }
  return active.length > 0 ? active.join(" · ") : "No limits set";
}

function manageActionGroups(
  surface: WalletProductSurface | null,
  encoded: string,
): ManageActionGroup[] {
  if (surface === "personal") {
    return [
      {
        label: "Money",
        rows: personalMoneyActionRows(encoded),
      },
      {
        label: "More",
        rows: [
          {
            href: `/app/wallet/${encoded}/chains/add?autostart=1`,
            icon: Network,
            title: "Add asset",
          },
        ],
      },
    ];
  }

  if (surface === "pro") {
    return [];
  }

  if (surface === "agent") {
    return [
      {
        label: "Networks",
        description: "Add a chain before funding or trading there.",
        rows: networkActionRows(encoded),
      },
      {
        label: "More budget",
        description: "Fine-tune capital assigned to trader activity.",
        rows: [
          {
            href: `/app/wallet/${encoded}/agents/funding`,
            icon: Banknote,
            title: "Trading budget",
            body: "Bounded capital for trader activity.",
          },
          {
            href: `/app/wallet/${encoded}/swap`,
            icon: Repeat2,
            title: "Swap crypto",
            body: "Manual review before agent automation.",
          },
        ],
      },
    ];
  }

  return [
    {
      label: "Protection",
      description: "Fine-tune people, approvals, and send safety.",
      rows: rulesActionRows(encoded, null),
    },
    {
      label: "Networks",
      description: "Add another chain to this wallet.",
      rows: networkActionRows(encoded),
    },
    {
      label: "More money",
      rows: moneyActionRows(encoded),
    },
  ];
}

function rulesActionRows(
  encoded: string,
  surface: WalletProductSurface | null,
): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/policy`,
      icon: ShieldCheck,
      title: "Protection",
      body:
        surface === "pro"
          ? "Approvals, people, limits, and alerts."
          : "Approvals, people, and alerts.",
    },
  ];
}

function networkActionRows(encoded: string): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/chains/add?autostart=1`,
      icon: Network,
      title: "Add chain",
      body: "Add an asset once.",
    },
  ];
}

function moneyActionRows(encoded: string): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/swap`,
      icon: Repeat2,
      title: "Swap crypto",
    },
    {
      href: `/app/wallet/${encoded}/buy`,
      icon: Banknote,
      title: "Buy crypto with your bank account",
    },
    {
      href: `/app/wallet/${encoded}/sell`,
      icon: TrendingDown,
      title: "Withdraw crypto to your bank account",
    },
  ];
}

function personalMoneyActionRows(encoded: string): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/buy`,
      icon: Banknote,
      title: "Buy crypto with your bank account",
    },
    {
      href: `/app/wallet/${encoded}/sell`,
      icon: TrendingDown,
      title: "Withdraw crypto to your bank account",
    },
  ];
}
