"use client";

// /app/wallet/[name]/policy. Spending policy editor v1.
//
// Hosts the three NEW client-side guardrails (allowlist, time window,
// per-friend caps via /allowances) and links to the existing per-
// wallet weekly cap (/budget). The /send pre-flight check folds all
// of these into a single yes/no via lib/retail/policyEvaluation.
//
// Same pre-alpha disclosure as /budget: enforcement is client-side
// until the on-chain program ships FHE-aware policy slots. The
// Encryption-ready chip is intentional honesty, not marketing.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType, type IntentAccount } from "@/lib/msig";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  Clock,
  Gauge,
  ListChecks,
  Lock,
  ShieldCheck,
  Slash,
  Trash2,
  UserCheck,
  Users,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import { useContacts } from "@/lib/hooks/useContacts";
import { isValidSolanaAddress, shortAddress } from "@/lib/retail/contacts";
import {
  DAY_LABELS,
  getAllowlist,
  getTimeWindow,
  saveAllowlist,
  saveTimeWindow,
  type Allowlist,
  type TimeWindow,
} from "@/lib/retail/policy";
import { toDisplayName } from "@/lib/retail/walletNames";
import { getWalletAppearance } from "@/lib/retail/walletAppearance";
import { walletProductSurface } from "@/lib/productWorkspace";
import {
  templateFileForChainKind,
} from "@/lib/hooks/useUpdateTimelock";
import { useUpdateApprovalThreshold } from "@/lib/hooks/useUpdateApprovalThreshold";
import { listPolicies, subscribePolicies } from "@/lib/policies/storage";
import { getBudget } from "@/lib/retail/spendingBudget";
import { listAllowances } from "@/lib/retail/allowances";

export default function PolicyPage() {
  const params = useParams<{ name: string }>();
  const { connection } = useConnection();
  const reduce = useReducedMotion();
  const toast = useToast();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
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
      return listIntents(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account.intentIndex,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const customIntent = useMemo(
    () =>
      (intentsQuery.data ?? []).find(
        (it) => it.account !== null && it.account.intentType === IntentType.Custom,
      )?.account ?? null,
    [intentsQuery.data],
  );
  const [advancedRuleCount, setAdvancedRuleCount] = useState(0);
  const [budgetLabel, setBudgetLabel] = useState("Not set");
  const [allowanceCount, setAllowanceCount] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setAdvancedRuleCount(listPolicies(name).length);
      const budget = getBudget(name);
      if (!budget) {
        setBudgetLabel("Not set");
      } else if (budget.weeklyUsd !== null) {
        setBudgetLabel(`$${budget.weeklyUsd.toLocaleString()} weekly`);
      } else if (budget.velocityPerDay) {
        setBudgetLabel(`${budget.velocityPerDay}/day`);
      } else {
        setBudgetLabel("Chain caps set");
      }
      setAllowanceCount(listAllowances(name).length);
    };
    refresh();
    return subscribePolicies(refresh);
  }, [name]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const display = toDisplayName(name);
  const surface = walletProductSurface(getWalletAppearance(name)?.surface);
  const personalRules = surface === "personal";

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Page header strip - mono eyebrow + display title, identity
          anchored by the wallet disc. Back navigation lives on the
          global header bar (mobile + desktop). */}
      <motion.header
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-card bg-surface-raised p-4 shadow-card-rest sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-x-6 sm:gap-y-4 sm:p-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/[0.06] blur-3xl"
        />
        <div className="relative z-10 flex min-w-0 items-center gap-3 sm:gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent sm:h-14 sm:w-14"
          >
            <WalletIcon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              {personalRules ? "Personal rules" : "Spending policy"} / {display}
            </p>
            <h1 className="mt-1 truncate font-display text-xl leading-[1.05] tracking-[-0.02em] text-text-strong sm:text-display-sm">
              {personalRules
                ? `How ${display} stays protected`
                : `How ${display} controls money`}
            </h1>
          </div>
        </div>
        <p className="relative z-10 mt-4 max-w-2xl text-sm leading-relaxed text-text-soft sm:mt-4 sm:text-base">
          {personalRules
            ? "Simple controls for approvals, trusted people, and signed spending."
            : "Approval rules, limits, recipients, and local guardrails before signing."}
        </p>
        <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 sm:mt-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas/70 px-3 py-1.5 text-[11px] font-medium text-text-soft">
            <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
            Encryption-ready / pre-alpha
          </span>
        </div>
      </motion.header>

      <PolicyFlow
        walletName={name}
        intent={customIntent}
        loading={walletQuery.isLoading || intentsQuery.isLoading}
        advancedRuleCount={advancedRuleCount}
        budgetLabel={budgetLabel}
        allowanceCount={allowanceCount}
        personalRules={personalRules}
      />

      <ThresholdCard
        walletName={name}
        intent={customIntent}
        loading={walletQuery.isLoading || intentsQuery.isLoading}
        reduce={!!reduce}
      />
      <AllowlistCard walletName={name} />
      <TimeWindowCard walletName={name} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!personalRules ? (
          <>
            <NavCard
              href={`/app/wallet/${encodeURIComponent(name)}/budget`}
              icon={Gauge}
              title="Weekly spending cap"
              body="Wallet-wide and per-chain dollar limits."
            />
            <NavCard
              href={`/app/wallet/${encodeURIComponent(name)}/allowances`}
              icon={UserCheck}
              title="Per-person caps"
              body="How much each member can move on their own."
            />
            <NavCard
              href={`/app/wallet/${encodeURIComponent(name)}/policies`}
              icon={ListChecks}
              title="Advanced policy rules"
              body="Extra allow, deny, review, and cooldown checks."
            />
          </>
        ) : null}
        <NavCard
          href="/app/settings#notifications"
          icon={Bell}
          title="Notification preferences"
          body="How this device alerts you when approvals wait."
        />
      </section>
    </div>
  );
}

function PolicyFlow({
  walletName,
  intent,
  loading,
  advancedRuleCount,
  budgetLabel,
  allowanceCount,
  personalRules,
}: {
  walletName: string;
  intent: IntentAccount | null;
  loading: boolean;
  advancedRuleCount: number;
  budgetLabel: string;
  allowanceCount: number;
  personalRules: boolean;
}) {
  const encoded = encodeURIComponent(walletName);
  const approverCount = intent?.approvers.length ?? 0;
  const threshold = intent
    ? `${intent.approvalThreshold} of ${approverCount}`
    : loading
      ? "Loading"
      : "Not set";
  const memberStatus = loading && !intent
    ? "Loading"
    : approverCount
      ? `${approverCount} signer${approverCount === 1 ? "" : "s"}`
      : "No signers";
  const timelock =
    intent && intent.timelockSeconds > 0
      ? `${Math.round(intent.timelockSeconds / 3600)}h hold`
      : intent
        ? "No hold"
        : "Not set";

  const steps: PolicyStep[] = [
    {
      href: "#approvals",
      Icon: ShieldCheck,
      label: "Approvals",
      status: threshold,
      body: "Required signatures before a request can move.",
      enforcement: "active",
    },
    {
      href: `/app/wallet/${encoded}/members`,
      Icon: Users,
      label: "Members",
      status: memberStatus,
      body: "Invite people and assign request or approval rights.",
      enforcement: "active",
    },
    {
      href: `/app/wallet/${encoded}/rules`,
      Icon: Clock,
      label: "Spending rule",
      status: timelock,
      body: "The on-chain intent that powers sending.",
      enforcement: "active",
    },
    ...(!personalRules
      ? [
          {
            href: `/app/wallet/${encoded}/budget`,
            Icon: Gauge,
            label: "Limits",
            status: budgetLabel,
            body: "Weekly, per-chain, and daily send-count caps.",
            enforcement: "preview" as const,
          },
          {
            href: `/app/wallet/${encoded}/allowances`,
            Icon: UserCheck,
            label: "Per-person caps",
            status: allowanceCount ? `${allowanceCount} set` : "Not set",
            body: "Individual spending limits for each member.",
            enforcement: "preview" as const,
          },
          {
            href: `/app/wallet/${encoded}/policies`,
            Icon: ListChecks,
            label: "Advanced rules",
            status: advancedRuleCount ? `${advancedRuleCount} saved` : "None",
            body: "Extra checks for recipients, amounts, and review.",
            enforcement: "preview" as const,
          },
        ]
      : []),
  ];

  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Control map
          </p>
          <h2 className="mt-1 font-display text-lg leading-tight text-text-strong">
            What protects this wallet
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-soft sm:text-sm">
            {personalRules
              ? "Active approvals and signed spending rules stay simple for trusted people."
              : "Active controls enforce signing. Preview guardrails run locally until encrypted policy execution is live."}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <PolicyStepCard key={step.label} step={step} />
        ))}
      </div>
    </section>
  );
}

interface PolicyStep {
  href: string;
  Icon: LucideIcon;
  label: string;
  status: string;
  body: string;
  enforcement: "active" | "preview";
}

function PolicyStepCard({ step }: { step: PolicyStep }) {
  const { href, Icon, label, status, body, enforcement } = step;
  return (
    <Link
      href={href}
      className={
        "group relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-card bg-canvas p-3.5 " +
        "transition-[background-color,transform,box-shadow] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-surface-raised hover:shadow-card-rest " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent opacity-0 transition-opacity duration-base group-hover:opacity-100"
      />
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-text-strong">
              {label}
            </p>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-text-soft transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
              aria-hidden="true"
            />
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-text-soft">
            {body}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-soft">
          {status}
        </p>
        <span
          className={
            "inline-flex rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] " +
            (enforcement === "active"
              ? "bg-accent/10 text-accent"
              : "bg-warning/10 text-warning")
          }
        >
          {enforcement === "active" ? "Active" : "Preview"}
        </span>
      </div>
    </Link>
  );
}

function ThresholdCard({
  walletName,
  intent,
  loading,
  reduce,
}: {
  walletName: string;
  intent: IntentAccount | null;
  loading: boolean;
  reduce: boolean;
}) {
  const toast = useToast();
  const update = useUpdateApprovalThreshold();
  const motionProps = reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const [draft, setDraft] = useState<number>(intent?.approvalThreshold ?? 1);

  useEffect(() => {
    setDraft(intent?.approvalThreshold ?? 1);
  }, [intent?.approvalThreshold, walletName]);

  if (loading) {
    return (
      <section className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-border-soft" />
        <div className="mt-3 h-4 w-72 animate-pulse rounded bg-border-soft" />
      </section>
    );
  }
  if (!intent) return null;

  const memberCount = intent.approvers.length;
  const current = intent.approvalThreshold;
  const canDecrease = draft > 1;
  const canIncrease = draft < memberCount;

  const apply = async () => {
    try {
      await update.mutateAsync({
        walletName,
        intentIndex: intent.intentIndex,
        newThreshold: draft,
        templateFile: templateFileForChainKind(intent.chainKind),
      });
      toast.success(`Approval quorum set to ${draft} of ${memberCount}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change quorum");
    }
  };

  return (
    <motion.section
      id="approvals"
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-6"
    >
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Approval quorum
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-text-soft">
            Right now this rule uses {current} of {memberCount}. Move it up to
            2-of-2 or 3-of-3 when you want everyone to sign.
          </p>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={() => setDraft((n) => Math.max(1, n - 1))}
          disabled={!canDecrease || update.isPending}
          className="inline-flex h-10 w-10 items-center justify-center rounded-soft bg-canvas text-text-soft transition-colors hover:text-text-strong disabled:opacity-50"
          aria-label="Lower quorum"
        >
          <Slash className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 rounded-soft bg-canvas px-4 py-2 text-center text-sm font-medium text-text-strong sm:text-left">
          {draft} of {memberCount}
        </div>
        <button
          type="button"
          onClick={() => setDraft((n) => Math.min(memberCount, n + 1))}
          disabled={!canIncrease || update.isPending}
          className="inline-flex h-10 w-10 items-center justify-center rounded-soft bg-canvas text-text-soft transition-colors hover:text-text-strong disabled:opacity-50"
          aria-label="Raise quorum"
        >
          <Check className="h-4 w-4 rotate-45" aria-hidden="true" />
        </button>
        <Button
          onClick={apply}
          disabled={draft === current || update.isPending}
          className="col-span-3 mt-1 w-full sm:col-auto sm:mt-0 sm:w-auto"
        >
          {update.isPending ? "Updating..." : "Save quorum"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-text-soft">
        This changes the on-chain approval threshold only. It does not
        remove members or change the timelock.
      </p>
    </motion.section>
  );
}

// Allowlist card

function AllowlistCard({ walletName }: { walletName: string }) {
  const toast = useToast();
  const contacts = useContacts();
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<Allowlist>({
    walletName,
    mode: "off",
    addresses: [],
    updatedAt: 0,
  });
  const [pasteAddress, setPasteAddress] = useState("");

  useEffect(() => {
    setDraft(getAllowlist(walletName));
    setHydrated(true);
  }, [walletName]);

  const setMode = (mode: "off" | "on") => {
    const next = { ...draft, mode };
    setDraft(next);
    saveAllowlist({
      walletName: next.walletName,
      mode: next.mode,
      addresses: next.addresses,
    });
  };

  const addAddress = (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
    if (!isValidSolanaAddress(trimmed)) {
      toast.error("That doesn't look like a valid Solana address");
      return;
    }
    if (draft.addresses.includes(trimmed)) {
      toast.info("Already on the allowlist");
      return;
    }
    const next = { ...draft, addresses: [...draft.addresses, trimmed] };
    setDraft(next);
    saveAllowlist({
      walletName: next.walletName,
      mode: next.mode,
      addresses: next.addresses,
    });
    setPasteAddress("");
    toast.success("Added to allowlist");
  };

  const removeAddress = (address: string) => {
    const next = {
      ...draft,
      addresses: draft.addresses.filter((a) => a !== address),
    };
    setDraft(next);
    saveAllowlist({
      walletName: next.walletName,
      mode: next.mode,
      addresses: next.addresses,
    });
  };

  const contactsNotOnList = contacts.contacts.filter(
    (c) => !draft.addresses.includes(c.address),
  );

  return (
    <section id="recipients" className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-6">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <UserCheck className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Allowlist
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-text-soft">
            When on, the app warns and blocks local sends to addresses outside
            this list before signing. On-chain enforcement arrives with the
            encrypted policy path.
          </p>
        </div>
      </header>

      <div className="mt-5 inline-flex rounded-full bg-canvas p-1 text-xs font-medium">
        <ToggleButton active={draft.mode === "off"} onClick={() => setMode("off")}>
          Off
        </ToggleButton>
        <ToggleButton active={draft.mode === "on"} onClick={() => setMode("on")}>
          On
        </ToggleButton>
      </div>

      {hydrated && draft.mode === "on" && draft.addresses.length === 0 ? (
        <p className="mt-4 rounded-card bg-warning/10 p-3 text-xs text-text-strong">
          The allowlist is empty. Until you add a recipient, every send
          will be blocked.
        </p>
      ) : null}

      {/* Add by contact */}
      {contactsNotOnList.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-text-soft">
            Add a contact
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {contactsNotOnList.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => addAddress(c.address)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5 text-xs font-medium text-text-strong " +
                    "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
                    "hover:-translate-y-0.5 hover:shadow-card-rest " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  <span>+ {c.name}</span>
                  <span className="font-mono text-[10px] text-text-soft">
                    {shortAddress(c.address)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Add by raw address */}
      <div className="mt-5">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-text-soft">
          Or paste an address
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={pasteAddress}
            onChange={(e) => setPasteAddress(e.target.value)}
            placeholder="Solana address"
            className={
              "min-w-0 flex-1 rounded-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => addAddress(pasteAddress)}
            disabled={!pasteAddress.trim()}
            className="sm:w-auto"
          >
            Add
          </Button>
        </div>
      </div>

      {/* Listed addresses */}
      {draft.addresses.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-2">
          {draft.addresses.map((addr) => {
            const contact = contacts.contacts.find((c) => c.address === addr);
            return (
              <li
                key={addr}
                className="flex items-center justify-between gap-3 rounded-card bg-canvas px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  {contact ? (
                    <>
                      <p className="text-sm font-medium text-text-strong">
                        {contact.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-text-soft">
                        {shortAddress(addr)}
                      </p>
                    </>
                  ) : (
                    <p className="truncate font-mono text-xs text-text-strong">
                      {shortAddress(addr)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeAddress(addr)}
                  aria-label={`Remove ${contact?.name ?? shortAddress(addr)} from the allowlist`}
                  className={
                    "rounded-soft p-1.5 text-text-soft transition-colors duration-base ease-out-soft hover:text-danger " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

// Time window card

function TimeWindowCard({ walletName }: { walletName: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<TimeWindow>({
    walletName,
    enabled: false,
    startHour: 9,
    endHour: 18,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    updatedAt: 0,
  });

  useEffect(() => {
    setDraft(getTimeWindow(walletName));
    setHydrated(true);
  }, [walletName]);

  const persist = (next: TimeWindow) => {
    setDraft(next);
    saveTimeWindow({
      walletName: next.walletName,
      enabled: next.enabled,
      startHour: next.startHour,
      endHour: next.endHour,
      daysOfWeek: next.daysOfWeek,
    });
  };

  const setEnabled = (enabled: boolean) => persist({ ...draft, enabled });
  const setStart = (h: number) => persist({ ...draft, startHour: h });
  const setEnd = (h: number) => persist({ ...draft, endHour: h });
  const toggleDay = (day: number) => {
    const has = draft.daysOfWeek.includes(day);
    const next = has
      ? draft.daysOfWeek.filter((d) => d !== day)
      : [...draft.daysOfWeek, day].sort();
    persist({ ...draft, daysOfWeek: next });
  };

  return (
    <section id="time-window" className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-6">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <CalendarClock className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Allowed hours
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-text-soft">
            Block sends outside business hours. Useful when you don&apos;t
            want a midnight popup to ever land in your wallet.
          </p>
        </div>
      </header>

      <div className="mt-5 inline-flex rounded-full bg-canvas p-1 text-xs font-medium">
        <ToggleButton active={!draft.enabled} onClick={() => setEnabled(false)}>
          Off
        </ToggleButton>
        <ToggleButton active={draft.enabled} onClick={() => setEnabled(true)}>
          On
        </ToggleButton>
      </div>

      {hydrated && draft.enabled ? (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HourPicker label="Start" value={draft.startHour} onChange={setStart} />
            <HourPicker label="End" value={draft.endHour} onChange={setEnd} />
          </div>
          <p className="mt-2 text-[11px] text-text-soft">
            Times are in your device&apos;s local time.
            {draft.startHour > draft.endHour
              ? " The window crosses midnight (e.g. 10pm to 6am)."
              : ""}
          </p>

          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-text-soft">
              Allowed days
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {DAY_LABELS.map((d) => {
                const active = draft.daysOfWeek.includes(d.value);
                return (
                  <li key={d.value}>
                    <button
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      aria-pressed={active}
                      className={
                        "rounded-full px-3 py-1.5 text-xs font-medium transition-[transform,background-color,color] duration-base ease-out-soft " +
                        (active
                          ? "bg-accent/10 text-accent"
                          : "bg-canvas text-text-soft hover:text-text-strong") +
                        " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                      }
                    >
                      {d.short}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}

function HourPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (h: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-card bg-canvas px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-text-soft">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className={
          "rounded-soft bg-transparent px-2 py-1 text-sm font-medium text-text-strong outline-none " +
          "transition-[border-color] duration-base ease-out-soft " +
          "focus:border-accent"
        }
      >
        {Array.from({ length: 24 }, (_, h) => h).map((h) => (
          <option key={h} value={h}>
            {formatHourOption(h)}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatHourOption(h: number): string {
  if (h === 0) return "12 am (midnight)";
  if (h === 12) return "12 pm (noon)";
  if (h < 12) return `${h} am`;
  return `${h - 12} pm`;
}

// Shared bits

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-3 py-1.5 transition-[background-color,color] duration-base ease-out-soft " +
        (active
          ? "bg-accent text-text-on-accent"
          : "text-text-soft hover:text-text-strong") +
        " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      }
    >
      {children}
    </button>
  );
}

function NavCard({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex items-start gap-3 rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5 " +
        "transition-[transform,background-color,box-shadow] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:bg-canvas hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">{title}</p>
        <p className="mt-0.5 text-xs text-text-soft">{body}</p>
      </div>
      <ArrowRight
        className="mt-1 h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden="true"
      />
    </Link>
  );
}
