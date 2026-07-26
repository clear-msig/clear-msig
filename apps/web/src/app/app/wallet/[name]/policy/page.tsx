"use client";

// /app/wallet/[name]/policy. Spending policy editor v1.
//
// Hosts the wallet guardrails: recipient allowlist, allowed-hours
// window, per-friend caps via /allowances, and the per-wallet weekly
// cap (/budget). Personal-wallet allowlist and hours can be synced
// into the on-chain wallet-policy PDA so typed sends are rejected by
// the program when they omit or violate the active policy.

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
  Gauge,
  ListChecks,
  Loader2,
  ShieldCheck,
  Slash,
  Trash2,
  UserCheck,
  Users,
  Wallet as WalletIcon,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import { useContacts } from "@/lib/hooks/useContacts";
import { shortAddress } from "@/lib/retail/contacts";
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
import { usePersistPersonalWalletPolicy } from "@/lib/hooks/usePersistWalletPolicy";
import {
  ALLOWLIST_CHAINS,
  allowlistChain,
  formatPolicySyncResult,
  isValidAllowlistAddress,
  normalizeAllowlistAddress,
} from "@/features/policies/domain/personalPolicy";

import { HourPicker, NavCard, ToggleButton } from "@/features/policies/ui/PolicyControls";

export default function PolicyPage() {
  const params = useParams<{ name: string }>();
  const { connection } = useConnection();
  const reduce = useReducedMotion();
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

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const display = toDisplayName(name);
  const surface = walletProductSurface(getWalletAppearance(name)?.surface);
  const personalRules = surface === "personal";

  return (
    <div className="flex flex-col gap-4">
      {/* Page header strip - mono eyebrow + display title, identity
          anchored by the wallet disc. Back navigation lives on the
          global header bar (mobile + desktop). */}
      <motion.header
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-4 sm:p-5"
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent sm:h-14 sm:w-14"
          >
            <WalletIcon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Protection / {display}
            </p>
            <h1 className="mt-1 truncate font-display text-xl leading-tight text-text-strong sm:text-display-xs">
              How {display} stays protected
            </h1>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-sm text-text-soft sm:mt-0">
          {personalRules
            ? "Choose who can approve, who can receive, and when ClearSig should slow a send down."
            : "Choose who can approve, how much can move, and when a send needs extra care."}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas/70 px-3 py-1.5 text-[11px] font-medium text-text-soft">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
            Read before signing
          </span>
        </div>
      </motion.header>

      <ThresholdCard
        walletName={name}
        intent={customIntent}
        loading={walletQuery.isLoading || intentsQuery.isLoading}
        reduce={!!reduce}
      />
      <PeopleCard
        walletName={name}
        intent={customIntent}
        loading={walletQuery.isLoading || intentsQuery.isLoading}
      />
      <ProtectionCoreLinks walletName={name} />

      <AdvancedProtectionPanel
        walletName={name}
        personalRules={personalRules}
      />
    </div>
  );
}

function ProtectionCoreLinks({ walletName }: { walletName: string }) {
  const encoded = encodeURIComponent(walletName);
  return (
    <section className="grid gap-3 sm:grid-cols-2" aria-label="Core protection controls">
      <NavCard
        href={`/app/wallet/${encoded}/budget`}
        icon={Gauge}
        title="Spending limits"
        body="Daily and weekly caps."
      />
      <NavCard
        href={`/app/wallet/${encoded}/rules`}
        icon={CalendarClock}
        title="Send delay"
        body="Wait before money moves."
      />
    </section>
  );
}

function PeopleCard({
  walletName,
  intent,
  loading,
}: {
  walletName: string;
  intent: IntentAccount | null;
  loading: boolean;
}) {
  const encoded = encodeURIComponent(walletName);
  const signers = intent?.approvers ?? [];

  return (
    <section
      id="people"
      className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Users className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-lg leading-tight text-text-strong">
              People
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              These are the people ClearSig checks before money moves.
            </p>
          </div>
        </div>
        <Link
          href={`/app/wallet/${encoded}/members/add`}
          className={
            "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
            "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          Add person
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </header>

      {loading ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <div className="h-12 animate-pulse rounded-card bg-border-soft" />
          <div className="h-12 animate-pulse rounded-card bg-border-soft" />
        </div>
      ) : signers.length > 0 ? (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {signers.map((address, index) => (
            <li
              key={address}
              className="flex items-center justify-between gap-3 rounded-card bg-canvas px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-strong">
                  Signer {index + 1}
                </p>
                <p className="truncate font-mono text-[11px] text-text-soft">
                  {shortAddress(address)}
                </p>
              </div>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                Can approve
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-card bg-warning/10 p-3 text-sm text-text-strong">
          No signer list yet. Turn on sending, then add the people who should
          approve.
        </p>
      )}

      <div className="mt-4">
        <Link
          href={`/app/wallet/${encoded}/members`}
          className="text-xs font-medium text-accent hover:text-accent-hover"
        >
          Manage people
        </Link>
      </div>
    </section>
  );
}

function AdvancedProtectionPanel({
  walletName,
  personalRules,
}: {
  walletName: string;
  personalRules: boolean;
}) {
  const encoded = encodeURIComponent(walletName);
  return (
    <details
      id="risk"
      className="group rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="text-sm font-semibold text-text-strong">
            Advanced
          </span>
          <span className="mt-0.5 block text-xs text-text-soft">
            Recipient checks, allowed hours, member caps, and alerts.
          </span>
        </span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <AllowlistCard walletName={walletName} />
        <TimeWindowCard walletName={walletName} />
        {!personalRules ? (
          <>
            <NavCard
              href={`/app/wallet/${encoded}/allowances`}
              icon={UserCheck}
              title="Member limits"
              body="Caps per person."
            />
            <NavCard
              href={`/app/wallet/${encoded}/policies`}
              icon={ListChecks}
              title="Extra checks"
              body="Policy internals."
            />
          </>
        ) : null}
        <NavCard
          href="/app/settings#notifications"
          icon={Bell}
          title="Notifications"
          body="Approval alerts."
        />
      </div>
    </details>
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
      <section className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5">
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
      const result = await update.mutateAsync({
        walletName,
        intentIndex: intent.intentIndex,
        newThreshold: draft,
        templateFile: templateFileForChainKind(intent.chainKind),
      });
      toast.success(
        result.kind === "awaiting_approvals"
          ? "Quorum change proposed and waiting for the remaining approvals"
          : `Approval quorum set to ${draft} of ${memberCount}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change quorum");
    }
  };

  return (
    <motion.section
      id="approvals"
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5"
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
  const persistPersonalPolicy = usePersistPersonalWalletPolicy();
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<Allowlist>({
    walletName,
    chainKind: 0,
    mode: "off",
    addresses: [],
    updatedAt: 0,
  });
  const [pasteAddress, setPasteAddress] = useState("");
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setDraft(getAllowlist(walletName));
    setHydrated(true);
    setDirty(false);
  }, [walletName]);

  const persistLocal = (next: Allowlist) => {
    setDraft(next);
    saveAllowlist({
      walletName: next.walletName,
      chainKind: next.chainKind,
      mode: next.mode,
      addresses: next.addresses,
    });
    setDirty(true);
  };

  const selectChain = (chainKind: number) => {
    setDraft(getAllowlist(walletName, chainKind));
  };

  const syncOnChain = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await persistPersonalPolicy(walletName);
      setDirty(false);
      toast.success("Recipient policy saved on chain", {
        details: formatPolicySyncResult(result),
      });
    } catch (err) {
      toast.error("Recipient policy saved locally, but not on chain", {
        details:
          err instanceof Error
            ? err.message
            : "The browser could not persist the allowlist on chain.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const setMode = (mode: "off" | "on") => {
    persistLocal({ ...draft, mode });
  };

  const addAddress = (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
    if (!isValidAllowlistAddress(draft.chainKind, trimmed)) {
      toast.error(`That doesn't look like a valid ${allowlistChain(draft.chainKind).label} address`);
      return;
    }
    const normalized = normalizeAllowlistAddress(draft.chainKind, trimmed);
    if (draft.addresses.includes(normalized)) {
      toast.info("Already on the allowlist");
      return;
    }
    if (draft.addresses.length >= 16) {
      toast.error("Allowlist is full", {
        details: "Program-enforced recipient lists support up to 16 addresses.",
      });
      return;
    }
    const next = { ...draft, addresses: [...draft.addresses, normalized] };
    persistLocal(next);
    setPasteAddress("");
    toast.success("Added to allowlist", {
      details: "Save on chain before relying on this recipient rule.",
    });
  };

  const removeAddress = (address: string) => {
    const next = {
      ...draft,
      addresses: draft.addresses.filter((a) => a !== address),
    };
    persistLocal(next);
  };

  const contactsNotOnList = draft.chainKind === 0
    ? contacts.contacts.filter((c) => !draft.addresses.includes(c.address))
    : [];
  const selectedChain = allowlistChain(draft.chainKind);

  return (
    <section id="recipients" className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <UserCheck className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Allowlist
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-text-soft">
            When on, typed {selectedChain.ticker} sends commit this list and the
            program rejects every recipient outside it during execution.
          </p>
        </div>
      </header>

      <label className="mt-5 block text-xs font-medium uppercase tracking-[0.16em] text-text-soft">
        Network
        <select
          value={draft.chainKind}
          onChange={(event) => selectChain(Number(event.target.value))}
          className="mt-2 block w-full rounded-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none focus:ring-2 focus:ring-accent"
        >
          {ALLOWLIST_CHAINS.map((chain) => (
            <option key={chain.chainKind} value={chain.chainKind}>
              {chain.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-5 inline-flex rounded-full bg-canvas p-1 text-xs font-medium">
        <ToggleButton active={draft.mode === "off"} onClick={() => setMode("off")}>
          Off
        </ToggleButton>
        <ToggleButton active={draft.mode === "on"} onClick={() => setMode("on")}>
          On
        </ToggleButton>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant={dirty ? "primary" : "secondary"}
          size="sm"
          onClick={syncOnChain}
          disabled={!hydrated || syncing}
        >
          {syncing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Saving on chain...
            </>
          ) : dirty ? (
            "Save on chain"
          ) : (
            "On-chain sync"
          )}
        </Button>
        <span className="text-xs text-text-soft">
          {dirty ? "Local changes need approval." : "Ready to sync when needed."}
        </span>
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
            aria-label="Approver address"
            value={pasteAddress}
            onChange={(e) => setPasteAddress(e.target.value)}
            placeholder={`${selectedChain.label} address`}
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
  const toast = useToast();
  const persistPersonalPolicy = usePersistPersonalWalletPolicy();
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<TimeWindow>({
    walletName,
    enabled: false,
    startHour: 9,
    endHour: 18,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    updatedAt: 0,
  });
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setDraft(getTimeWindow(walletName));
    setHydrated(true);
    setDirty(false);
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
    setDirty(true);
  };

  const syncOnChain = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await persistPersonalPolicy(walletName);
      setDirty(false);
      toast.success("Allowed-hours policy saved on chain", {
        details: formatPolicySyncResult(result),
      });
    } catch (err) {
      toast.error("Allowed hours saved locally, but not on chain", {
        details:
          err instanceof Error
            ? err.message
            : "The browser could not persist the allowed-hours rule on chain.",
      });
    } finally {
      setSyncing(false);
    }
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
    <section id="time-window" className="rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <CalendarClock className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Allowed hours
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-text-soft">
            The signed timezone and selected hours are checked against the
            program clock before a typed send can execute.
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant={dirty ? "primary" : "secondary"}
          size="sm"
          onClick={syncOnChain}
          disabled={!hydrated || syncing}
        >
          {syncing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Saving on chain...
            </>
          ) : dirty ? (
            "Save on chain"
          ) : (
            "On-chain sync"
          )}
        </Button>
        <span className="text-xs text-text-soft">
          {dirty ? "Local changes need approval." : "Ready to sync when needed."}
        </span>
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
