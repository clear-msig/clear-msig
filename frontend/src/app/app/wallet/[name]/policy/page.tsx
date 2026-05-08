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
import {
  ArrowRight,
  CalendarClock,
  Check,
  Clock,
  Lock,
  Trash2,
  UserCheck,
  Wallet as WalletIcon,
} from "lucide-react";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
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

export default function PolicyPage() {
  const params = useParams<{ name: string }>();
  const reduce = useReducedMotion();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Policy" },
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Spending policy
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          How {toDisplayName(name)} controls money
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          Layers of guardrails on top of your wallet's threshold rules.
          Recipients you allow, hours you allow, caps per person, caps
          per week. Each guardrail blocks before signing.
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-xs font-medium text-text-soft">
          <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          Encryption-ready · pre-alpha
        </span>
      </motion.section>

      <AllowlistCard walletName={name} />
      <TimeWindowCard walletName={name} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NavCard
          href={`/app/wallet/${encodeURIComponent(name)}/budget`}
          icon={WalletIcon}
          title="Weekly spending cap"
          body="Wallet-wide and per-chain dollar limits."
        />
        <NavCard
          href={`/app/wallet/${encodeURIComponent(name)}/allowances`}
          icon={UserCheck}
          title="Per-person caps"
          body="How much each friend can move on their own."
        />
      </section>
    </div>
  );
}

// ─── Allowlist card ─────────────────────────────────────────────────

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
    <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest sm:p-7">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <UserCheck className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Allowlist
          </h2>
          <p className="mt-1 text-sm text-text-soft">
            When on, this wallet will only send to addresses on the list.
            Everything else is blocked before signing.
          </p>
        </div>
      </header>

      <div className="mt-5 inline-flex rounded-full border border-border-soft p-1 text-xs font-medium">
        <ToggleButton active={draft.mode === "off"} onClick={() => setMode("off")}>
          Off
        </ToggleButton>
        <ToggleButton active={draft.mode === "on"} onClick={() => setMode("on")}>
          On
        </ToggleButton>
      </div>

      {hydrated && draft.mode === "on" && draft.addresses.length === 0 ? (
        <p className="mt-4 rounded-card border border-warning/40 bg-warning/[0.10] p-3 text-xs text-text-strong">
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
                    "inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-strong " +
                    "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
                    "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest " +
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
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={pasteAddress}
            onChange={(e) => setPasteAddress(e.target.value)}
            placeholder="Solana address"
            className={
              "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => addAddress(pasteAddress)}
            disabled={!pasteAddress.trim()}
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
                className="flex items-center justify-between gap-3 rounded-card border border-border-soft bg-canvas px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  {contact ? (
                    <>
                      <p className="text-sm font-medium text-text-strong">
                        {contact.name}
                      </p>
                      <p className="font-mono text-[11px] text-text-soft">
                        {shortAddress(addr)}
                      </p>
                    </>
                  ) : (
                    <p className="font-mono text-xs text-text-strong">
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

// ─── Time window card ───────────────────────────────────────────────

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
    <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest sm:p-7">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <CalendarClock className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg leading-tight text-text-strong">
            Allowed hours
          </h2>
          <p className="mt-1 text-sm text-text-soft">
            Block sends outside business hours. Useful when you don&apos;t
            want a midnight popup to ever land in your wallet.
          </p>
        </div>
      </header>

      <div className="mt-5 inline-flex rounded-full border border-border-soft p-1 text-xs font-medium">
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
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-[transform,border-color,background-color,color] duration-base ease-out-soft " +
                        (active
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border-soft bg-canvas text-text-soft hover:border-accent hover:text-text-strong") +
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
    <label className="flex items-center justify-between gap-3 rounded-card border border-border-soft bg-canvas px-3 py-2">
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

// ─── Shared bits ────────────────────────────────────────────────────

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
  icon: typeof Clock;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
        "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
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

// Avoid unused-import lint nag for icons exposed for future cards.
void Check;
