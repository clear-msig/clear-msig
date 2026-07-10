"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  Bell,
  Heart,
  Network,
  PauseCircle,
  ReceiptText,
  Repeat2,
  Send,
  ShieldCheck,
  TrendingDown,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useContacts } from "@/lib/hooks/useContacts";
import {
  getEmergencyPause,
  saveEmergencyPause,
} from "@/lib/retail/policy";
import {
  getSpendingCategories,
  saveSpendingCategories,
  type SpendingCategory,
} from "@/lib/retail/spendingCategories";
import {
  listPersonalReceipts,
  recordPersonalReceipt,
  type PersonalReceipt,
} from "@/lib/retail/personalReceipts";
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
  const contacts = useContacts();
  const [pause, setPause] = useState(() => getEmergencyPause(walletName));
  const [categories, setCategories] = useState<SpendingCategory[]>(() =>
    getSpendingCategories(walletName),
  );
  const [receipts, setReceipts] = useState<PersonalReceipt[]>(() =>
    listPersonalReceipts(walletName),
  );

  useEffect(() => {
    const refresh = () => {
      setPause(getEmergencyPause(walletName));
      setCategories(getSpendingCategories(walletName));
      setReceipts(listPersonalReceipts(walletName));
    };
    refresh();
    window.addEventListener("clear:personal-receipts-changed", refresh);
    window.addEventListener("clear:emergency-pause-changed", refresh);
    window.addEventListener("clear:spending-categories-changed", refresh);
    return () => {
      window.removeEventListener("clear:personal-receipts-changed", refresh);
      window.removeEventListener("clear:emergency-pause-changed", refresh);
      window.removeEventListener("clear:spending-categories-changed", refresh);
    };
  }, [walletName]);

  const togglePause = () => {
    const next = saveEmergencyPause(walletName, !pause.paused);
    setPause(next);
    const paused = next.paused;
    recordPersonalReceipt(walletName, {
      title: paused ? "You paused sends." : "You resumed sends.",
      body: paused
        ? "New sends are blocked until you resume from Protection."
        : "This wallet can send again under its approval rules.",
    });
  };

  const toggleCategory = (id: SpendingCategory["id"]) => {
    const changed = categories.find((category) => category.id === id);
    const next = categories.map((category) =>
      category.id === id
        ? { ...category, enabled: !category.enabled }
        : category,
    );
    setCategories(next);
    saveSpendingCategories(walletName, next);
    const updated = next.find((category) => category.id === id);
    if (changed && updated) {
      recordPersonalReceipt(walletName, {
        title: `${updated.label} ${updated.enabled ? "added" : "hidden"}.`,
        body: updated.enabled
          ? `${updated.label} is now visible as a spending category.`
          : `${updated.label} is hidden from the category shortcuts.`,
      });
    }
  };
  const latestReceipt = receipts[0] ?? null;

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Protection
          </p>
          <h2 className="mt-1 font-display text-lg leading-tight text-text-strong">
            A shared wallet normal people can trust.
          </h2>
        </div>
        <button
          type="button"
          onClick={togglePause}
          className={
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition " +
            (pause.paused
              ? "border border-warning/40 bg-warning/10 text-warning"
              : "border border-border-soft bg-canvas text-text-strong hover:border-accent/40 hover:text-accent")
          }
        >
          <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {pause.paused ? "Resume" : "Pause"}
        </button>
      </div>

      {pause.paused ? (
        <div className="mt-3 rounded-soft border border-warning/30 bg-warning/[0.07] px-3 py-2 text-xs leading-relaxed text-text-soft">
          Sends are paused. Receiving money and reviewing history still work.
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/members`}
          icon={Users}
          title="People"
          value={`${contacts.contacts.length} saved`}
        />
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/policy`}
          icon={ShieldCheck}
          title="Approvals"
          value="Readable"
        />
        <PersonalSafetyLink
          href="/app/secure"
          icon={Heart}
          title="Recovery"
          value="Calm"
        />
        <PersonalSafetyLink
          href="/app/settings#notifications"
          icon={Bell}
          title="Notifications"
          value="Mobile-first"
        />
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/buy`}
          icon={Banknote}
          title="Buy"
          value="Bank"
        />
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/sell`}
          icon={TrendingDown}
          title="Withdraw"
          value="Bank"
        />
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-soft">
          Categories
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => toggleCategory(category.id)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                (category.enabled
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
              }
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-strong">
              {latestReceipt?.title ?? "Receipts will appear here."}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-text-soft">
              {latestReceipt?.body ??
                "Every protection change gets a readable receipt."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonalSafetyLink({
  href,
  icon: Icon,
  title,
  value,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-16 items-center gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2 transition hover:border-accent/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text-strong">
          {title}
        </span>
        <span className="block truncate text-xs text-text-soft">{value}</span>
      </span>
      <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-text-soft transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
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
