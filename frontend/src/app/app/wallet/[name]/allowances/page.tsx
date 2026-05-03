"use client";

// Per-friend allowances — "Sarah can spend up to $200/week from
// Roommates." Stored locally for now; the UI hint on /send and the
// member-row badge read these to surface "within limit" / "needs
// extra approval" cues. On-chain enforcement comes when the program
// adds an `allowance_per_approver` field to the intent (Months 3-4
// roadmap item).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Wallet as WalletIcon } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import {
  getAllowance,
  PERIOD_OPTIONS,
  removeAllowance,
  saveAllowance,
  type AllowancePeriod,
  type FriendAllowance,
} from "@/lib/retail/allowances";
import { useContacts } from "@/lib/hooks/useContacts";
import { shortAddress } from "@/lib/retail/contacts";
import { toDisplayName } from "@/lib/retail/walletNames";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { useToast } from "@/components/ui/Toast";

export default function AllowancesPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58() ?? "";
  const contacts = useContacts();
  const toast = useToast();

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

  const members = useMemo(() => {
    if (!intentsQuery.data) return [];
    const seen = new Set<string>();
    for (const it of intentsQuery.data) {
      if (!it.account) continue;
      for (const a of it.account.approvers) seen.add(a);
    }
    if (me) seen.add(me);
    return Array.from(seen).map((address) => ({
      address,
      isYou: address === me,
      contactName:
        contacts.contacts.find((c) => c.address === address)?.name ?? null,
    }));
  }, [intentsQuery.data, me, contacts.contacts]);

  // Local form state mirror — one entry per member, hydrated from
  // localStorage on mount and after any save.
  const [drafts, setDrafts] = useState<Record<string, AllowanceDraft>>({});
  useEffect(() => {
    if (!name) return;
    const next: Record<string, AllowanceDraft> = {};
    for (const m of members) {
      const stored = getAllowance(name, m.address);
      next[m.address] = stored
        ? {
            amountSol: stored.amountSol.toString(),
            period: stored.period,
            stored,
          }
        : { amountSol: "", period: "none", stored: null };
    }
    setDrafts(next);
  }, [name, members.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const handleSave = (address: string) => {
    const draft = drafts[address];
    if (!draft) return;
    const amt = Number(draft.amountSol);
    if (draft.period !== "none") {
      if (!isFinite(amt) || amt <= 0) {
        toast.error("Enter an amount", {
          details: "Pick how much SOL they can spend before they need extra approval.",
        });
        return;
      }
    }
    const saved = saveAllowance({
      walletName: name,
      friendAddress: address,
      amountSol: draft.period === "none" ? 0 : amt,
      period: draft.period,
    });
    setDrafts((d) => ({
      ...d,
      [address]: { ...d[address], stored: saved },
    }));
    toast.success(
      `Limit saved for ${draft.period === "none" ? "this friend" : "this friend"}`,
    );
  };

  const handleClear = (address: string) => {
    removeAllowance(name, address);
    setDrafts((d) => ({
      ...d,
      [address]: { amountSol: "", period: "none", stored: null },
    }));
    toast.success("Limit cleared");
  };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            {
              label: "Members",
              href: `/app/wallet/${encodeURIComponent(name)}/members`,
            },
            { label: "Spending limits" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <WalletIcon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Spending limits
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          What each member can spend
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          Pick a per-period limit for each person (friend, teammate,
          or board member). Requests inside the limit are easier to
          approve; anything above it follows the full {name} approval
          rule.
        </p>
        <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] text-text-soft">
          Watchers don&rsquo;t spend, so they&rsquo;re not listed.
          Max 16 members per wallet (chain limit).
        </p>
      </motion.section>

      <ul className="flex flex-col gap-3">
        {members.map((m) => {
          const draft = drafts[m.address];
          if (!draft) return null;
          const dirty = isDirty(draft);
          return (
            <li
              key={m.address}
              className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
            >
              <div className="flex items-center gap-3">
                <MemberAvatar address={m.address} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-strong">
                    {m.contactName ?? (m.isYou ? "You" : shortAddress(m.address))}
                    {m.isYou && m.contactName && (
                      <span className="ml-1 text-text-soft">(you)</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-text-soft">
                    {shortAddress(m.address)}
                  </p>
                </div>
                {draft.stored && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    Limit set
                  </span>
                )}
              </div>

              {/* Period FIRST, amount second — feedback: tapping the
                  amount input first read as broken because it's
                  disabled until a non-"no-limit" period is chosen.
                  Asking for the period up front matches the actual
                  decision order ("how often" → "how much"). */}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <select
                  value={draft.period}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [m.address]: {
                        ...d[m.address],
                        period: e.target.value as AllowancePeriod,
                      },
                    }))
                  }
                  className={
                    "rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none " +
                    "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                    "focus:border-accent focus:shadow-accent-rest sm:w-44"
                  }
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <div className="flex flex-1 items-baseline gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.amountSol}
                    onChange={(e) =>
                      setDrafts((d) => ({
                        ...d,
                        [m.address]: {
                          ...d[m.address],
                          amountSol: sanitizeAmount(e.target.value),
                        },
                      }))
                    }
                    placeholder={
                      draft.period === "none" ? "Pick a period first" : "0"
                    }
                    disabled={draft.period === "none"}
                    maxLength={20}
                    className={
                      "flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-base text-text-strong outline-none " +
                      "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                      "focus:border-accent focus:shadow-accent-rest " +
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    }
                  />
                  <span className="text-sm text-text-soft">SOL</span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-text-soft">
                  {currentSummary(draft)}
                </p>
                <div className="flex items-center gap-2">
                  {draft.stored && (
                    <button
                      type="button"
                      onClick={() => handleClear(m.address)}
                      className="text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-danger"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSave(m.address)}
                    disabled={!dirty}
                    className={
                      "rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white shadow-accent-rest " +
                      "transition-[background-color,transform] duration-base ease-out-soft " +
                      "hover:bg-accent-hover active:scale-[0.98] " +
                      "disabled:cursor-not-allowed disabled:opacity-40"
                    }
                  >
                    Save limit
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {members.length === 0 && !walletQuery.isLoading && (
          <li className="rounded-card border border-border-soft bg-surface-raised p-5 text-center text-sm text-text-soft shadow-card-rest">
            No friends in this wallet yet. Add a friend first, then come
            back to set their limit.
          </li>
        )}
      </ul>

      <p className="text-center text-xs text-text-soft">
        Limits are saved on this device while we wait for on-chain
        enforcement. They&rsquo;re a hint to you; every request still
        follows {name}&rsquo;s approval rule today.
      </p>
    </div>
  );
}

interface AllowanceDraft {
  amountSol: string;
  period: AllowancePeriod;
  stored: FriendAllowance | null;
}

function isDirty(draft: AllowanceDraft): boolean {
  if (!draft.stored) {
    if (draft.period === "none") return true;
    return draft.amountSol.trim().length > 0;
  }
  if (draft.period !== draft.stored.period) return true;
  if (draft.period === "none") return false;
  return Number(draft.amountSol) !== draft.stored.amountSol;
}

function currentSummary(draft: AllowanceDraft): string {
  if (!draft.stored) return "No limit saved yet";
  if (draft.stored.period === "none") return "Currently: no limit";
  const period =
    draft.stored.period === "weekly" ? "per week" : "per month";
  return `Currently: ${draft.stored.amountSol} SOL ${period}`;
}

function sanitizeAmount(raw: string): string {
  const stripped = raw.replace(/[^\d.]/g, "");
  const [whole = "", frac] = stripped.split(".");
  const w = whole.slice(0, 12);
  return frac === undefined ? w : `${w}.${frac.slice(0, 4)}`;
}
