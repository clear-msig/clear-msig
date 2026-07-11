"use client";

// Per-friend allowances - "Sarah can spend up to N SOL/week from this
// wallet." Authored in localStorage, then encoded into CSP1 policy
// bytes (EXT_MEMBER_ALLOWANCE) and enforced on typed sends via the
// MemberAllowanceLedger PDA when the SOL personal policy is persisted
// or a send includes the active policy plan.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Wallet as WalletIcon } from "lucide-react";
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
import { resolveWalletProductSurface } from "@/lib/productWorkspace";
import { BadgePill } from "@/components/retail/BadgePill";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { NativeSelect, TextInput } from "@/components/retail/FormField";
import { useToast } from "@/components/ui/Toast";
import { usePersistPersonalWalletPolicy } from "@/lib/hooks/usePersistWalletPolicy";
import { formatPolicySyncResult } from "@/features/policies/domain/personalPolicy";
import { fromHex } from "@/lib/msig";
import { decodeMemberAllowanceCaps } from "@/lib/policies/onchain";
import {
  currentWalletPolicyCommitment,
  EMPTY_POLICY_COMMITMENT,
  resolvePersistentSendPolicy,
} from "@/lib/policies/persistentWalletPolicy";

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
  const persistWalletPolicy = usePersistPersonalWalletPolicy();
  const [pendingMember, setPendingMember] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<Record<string, "active" | "waiting">>({});
  const productSurface = resolveWalletProductSurface(name);
  const isPro = productSurface === "pro";

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
  const activeAllowancesQuery = useQuery({
    queryKey: ["active-member-allowances", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      const commitment = await currentWalletPolicyCommitment(
        connection,
        walletQuery.data.pda,
        0,
      );
      if (commitment === EMPTY_POLICY_COMMITMENT) return [];
      const policy = await resolvePersistentSendPolicy(
        connection,
        walletQuery.data.pda,
        name,
        0,
      );
      return policy ? decodeMemberAllowanceCaps(fromHex(policy.hex)) : [];
    },
    enabled: Boolean(walletQuery.data),
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

  // The active on-chain policy is authoritative. localStorage remains an
  // authoring cache so subsequent policy updates can be compiled locally.
  const [drafts, setDrafts] = useState<Record<string, AllowanceDraft>>({});
  useEffect(() => {
    if (!name) return;
    const activeByMember = activeAllowancesQuery.isSuccess
      ? new Map(activeAllowancesQuery.data.map((cap) => [cap.member, cap]))
      : null;
    const next: Record<string, AllowanceDraft> = {};
    for (const m of members) {
      const active = activeByMember?.get(m.address);
      if (activeByMember) removeAllowance(name, m.address);
      const stored = active
        ? saveAllowance({
            walletName: name,
            friendAddress: m.address,
            amountSol: Number(active.capRaw) / 1_000_000_000,
            period: active.windowSeconds >= 30 * 24 * 60 * 60 ? "monthly" : "weekly",
          })
        : activeByMember
          ? null
          : getAllowance(name, m.address);
      next[m.address] = stored
        ? {
            amountSol: stored.amountSol.toString(),
            period: stored.period,
            stored,
          }
        : { amountSol: "", period: "none", stored: null };
    }
    setDrafts(next);
    if (activeByMember) {
      setSyncState(
        Object.fromEntries([...activeByMember.keys()].map((address) => [address, "active"])),
      );
    }
  }, [activeAllowancesQuery.data, activeAllowancesQuery.isSuccess, members, name]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const handleSave = async (address: string) => {
    const draft = drafts[address];
    if (!draft) return;
    const amt = Number(draft.amountSol);
    if (draft.period !== "none") {
      if (!isFinite(amt) || amt <= 0) {
        toast.error("Enter an amount", {
          details: isPro
            ? "Pick how much SOL this team member can spend before extra approval."
            : "Pick how much SOL they can spend before they need extra approval.",
        });
        return;
      }
    }
    const previous = getAllowance(name, address);
    const saved = saveAllowance({
      walletName: name,
      friendAddress: address,
      amountSol: draft.period === "none" ? 0 : amt,
      period: draft.period,
    });
    setPendingMember(address);
    try {
      const result = await persistWalletPolicy(name);
      setDrafts((current) => ({
        ...current,
        [address]: { ...current[address], stored: saved },
      }));
      setSyncState((current) => ({
        ...current,
        [address]: result.waiting > 0 ? "waiting" : "active",
      }));
      if (result.updated > 0) void activeAllowancesQuery.refetch();
      toast.success(
        result.waiting > 0
          ? "Member limit proposed"
          : `Limit active for ${isPro ? "this team member" : "this person"}`,
        { details: formatPolicySyncResult(result) },
      );
    } catch (error) {
      if (previous) saveAllowance(previous);
      else removeAllowance(name, address);
      toast.error("Member limit was not saved", {
        details: error instanceof Error ? error.message : "On-chain protection update failed.",
      });
    } finally {
      setPendingMember(null);
    }
  };

  const handleClear = async (address: string) => {
    const previous = getAllowance(name, address);
    removeAllowance(name, address);
    setPendingMember(address);
    try {
      const result = await persistWalletPolicy(name);
      setDrafts((current) => ({
        ...current,
        [address]: { amountSol: "", period: "none", stored: null },
      }));
      setSyncState((current) => {
        const next = { ...current };
        delete next[address];
        return next;
      });
      if (result.updated > 0) void activeAllowancesQuery.refetch();
      toast.success(result.waiting > 0 ? "Limit removal proposed" : "Limit removed on chain", {
        details: formatPolicySyncResult(result),
      });
    } catch (error) {
      if (previous) saveAllowance(previous);
      toast.error("Member limit was not removed", {
        details: error instanceof Error ? error.message : "On-chain protection update failed.",
      });
    } finally {
      setPendingMember(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            {
              label: isPro ? "Team" : "Members",
              href: `/app/wallet/${encodeURIComponent(name)}/members`,
            },
            { label: "Spending limits" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip - see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <WalletIcon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Spending limits
        </p>
        <h1 className="hidden md:block mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          What each member can spend
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          {isPro
            ? "Set program-enforced SOL limits for each team member. Sends above a member's remaining allowance are rejected on chain."
            : "Set program-enforced SOL limits for each person. Sends above a person's remaining allowance are rejected on chain."}
        </p>
        <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] text-text-soft">
          View-only members are not listed.
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
                    {pendingMember === m.address ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    )}
                    {pendingMember === m.address
                      ? "Saving on chain"
                      : syncState[m.address] === "waiting"
                        ? "Awaiting approvals"
                        : syncState[m.address] === "active"
                          ? "Limit active"
                          : "Saved locally"}
                  </span>
                )}
              </div>

              {/* Period FIRST, amount second - feedback: tapping the
                  amount input first read as broken because it's
                  disabled until a non-"no-limit" period is chosen.
                  Asking for the period up front matches the actual
                  decision order ("how often" → "how much"). */}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <NativeSelect
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
                  className="sm:w-44"
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
                <div className="flex flex-1 items-baseline gap-2">
                  <TextInput
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
                    className="flex-1 text-base"
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
                      onClick={() => void handleClear(m.address)}
                      disabled={pendingMember === m.address}
                      className="text-xs text-text-soft transition-colors duration-base ease-out-soft hover:text-danger"
                    >
                      Clear
                    </button>
                  )}
                  <BadgePill
                    onClick={() => void handleSave(m.address)}
                    disabled={!dirty || pendingMember === m.address}
                  >
                    Save limit
                  </BadgePill>
                </div>
              </div>
            </li>
          );
        })}
        {members.length === 0 && !walletQuery.isLoading && (
          <li className="rounded-card border border-border-soft bg-surface-raised p-5 text-center text-sm text-text-soft shadow-card-rest">
            {isPro
              ? "No team members yet. Add a team member first, then set limits."
              : "No people in this wallet yet. Add someone first, then set their limit."}
          </li>
        )}
      </ul>

      <p className="text-center text-xs text-text-soft">
        {isPro
          ? "Limits guide treasury review today. Approval rules still protect every request."
          : "Limits are saved on this device today. Every request still follows the wallet approval rule."}
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
