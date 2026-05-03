"use client";

// Members — who's in this shared wallet, what each can do, and what
// they're allowed to spend.
//
// Today's program model: every intent carries an `approvers` list and
// a uniform threshold. Retail vocabulary maps:
//   approver         → "Can approve"
//   approver + you   → "You" (with the same Can-approve power)
// Per-friend allowances and a Viewer role aren't on chain yet — both
// need program changes. We surface them here as the destination state
// with an honest "coming when Encrypt is live" note, mirroring the
// FHE-scaffold we shipped at /privacy.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Lock, Pencil, Trash2, UserPlus } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { deriveRole, listWatchers, ROLE_HINT, ROLE_LABEL, type Role } from "@/lib/retail/roles";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { avatarInitials } from "@/lib/retail/avatar";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useRemoveMember } from "@/lib/hooks/useRemoveMember";
import { useUpdateMemberRole } from "@/lib/hooks/useUpdateMemberRole";
import { useToast } from "@/components/ui/Toast";
import { friendlyError } from "@/lib/api/errors";

export default function MembersPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const { connection } = useConnection();
  const wallet = useWallet();
  const reduce = useReducedMotion();
  const me = wallet.publicKey?.toBase58() ?? "";

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
    // Aggregate proposers + approvers across all intents so a friend
    // who's an approver-only on one rule and a proposer on another
    // shows up correctly. Today we only have one rule, but the data
    // model supports multiple.
    const proposerSet = new Set<string>();
    const approverSet = new Set<string>();
    for (const it of intentsQuery.data) {
      if (!it.account) continue;
      for (const a of it.account.approvers) approverSet.add(a);
      for (const p of it.account.proposers) proposerSet.add(p);
    }
    // Make sure the connected user shows up even if the wallet hasn't
    // yet been bound to an intent (fresh wallets pre-setup).
    if (me) approverSet.add(me);
    const watchers = listWatchers(name);
    const allAddresses = new Set<string>([
      ...proposerSet,
      ...approverSet,
      ...watchers.map((w) => w.address),
    ]);
    const proposersArr = Array.from(proposerSet);
    const approversArr = Array.from(approverSet);
    return Array.from(allAddresses).map((address) => ({
      address,
      role: deriveRole(address, proposersArr, approversArr, watchers),
      isYou: address === me,
    }));
  }, [intentsQuery.data, me, name]);

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Members" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Members
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Who&rsquo;s in {toDisplayName(name)}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          {members.length === 1
            ? "Just you for now."
            : `You and ${members.length - 1} other${members.length - 1 === 1 ? "" : "s"} can act on this wallet.`}
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
          Privacy-ready · pre-alpha
        </Link>
      </motion.section>

      {/* Real signed flow — appends the friend's address to this
          wallet's spending-rule approver list and saves them as a
          contact for /send. */}
      <Link
        href={`/app/wallet/${encodeURIComponent(name)}/members/add`}
        className="block w-full"
      >
        <Button size="lg" fullWidth>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add a friend
        </Button>
      </Link>

      <Link
        href={`/app/wallet/${encodeURIComponent(name)}/allowances`}
        className={
          "self-center inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-text-soft " +
          "transition-[border-color,color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        Set spending limits
      </Link>

      {/* Member list */}
      <section>
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Member list
        </h2>
        {intentsQuery.isLoading ? (
          <div className="mt-3 space-y-2">
            <MemberRowSkeleton />
            <MemberRowSkeleton />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {members.map((m, i) => (
              <MemberRow
                key={m.address}
                walletName={name}
                address={m.address}
                role={m.role}
                isYou={m.isYou}
                delay={i * 0.04}
                reduce={!!reduce}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Allowances callout — destination state, marked as preview. */}
      <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Lock className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <p className="font-display text-base text-text-strong">
              Per-friend spending limits
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-text-soft">
              Set a daily, weekly, or monthly cap for each friend. The
              wallet enforces it on chain, and the limits stay
              encrypted, so nobody outside this wallet can read them.
            </p>
            <p className="mt-2 text-xs text-text-soft">
              <Link
                href="/privacy"
                className="font-medium text-accent transition-colors duration-base ease-out-soft hover:text-accent-hover"
              >
                How privacy works
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Row — one member ──────────────────────────────────────────────

interface MemberRowProps {
  walletName: string;
  address: string;
  role: Role | "unknown";
  isYou: boolean;
  delay: number;
  reduce: boolean;
}

function MemberRow({
  walletName,
  address,
  role,
  isYou,
  delay,
  reduce,
}: MemberRowProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  const walletDisplay = toDisplayName(walletName);
  const initials = avatarInitials(address);
  const displayName = isYou ? "You" : `Member ${initials}`;
  const subtitle =
    role === "full"
      ? "Can spend and approve"
      : role === "approver"
        ? "Can approve requests"
        : role === "watcher"
          ? "Watching"
          : "Member";

  const remove = useRemoveMember();
  const updateRole = useUpdateMemberRole();
  const toast = useToast();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [editingRole, setEditingRole] = useState(false);

  const canRemove = !isYou && role !== "unknown";
  const canEditRole = !isYou && role !== "unknown";
  const busy = remove.isPending || updateRole.isPending;

  const handleChangeRole = async (next: Role) => {
    if (next === role) {
      setEditingRole(false);
      return;
    }
    try {
      await updateRole.mutateAsync({
        walletName,
        friendAddress: address,
        newRole: next,
      });
      const verb =
        next === "watcher"
          ? "now watching"
          : next === "approver"
            ? "now approve-only"
            : "now spends and approves";
      toast.success(`${displayName} is ${verb}`);
      setEditingRole(false);
    } catch (err) {
      console.error("[update-role]", err);
      const fe = friendlyError(err, "add-friend");
      toast.error(fe.title, { details: fe.body });
    }
  };

  const handleConfirmRemove = async () => {
    try {
      await remove.mutateAsync({ walletName, friendAddress: address, role });
      toast.success(
        role === "watcher"
          ? "Watcher removed"
          : `${displayName} removed from ${walletDisplay}`,
      );
      setConfirmingRemove(false);
    } catch (err) {
      console.error("[remove-member]", err);
      const fe = friendlyError(err, "add-friend");
      toast.error(fe.title, { details: fe.body });
    }
  };

  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
    >
      <div className="flex items-center gap-3">
        <MemberAvatar address={address} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-strong">
            {displayName}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">{subtitle}</p>
        </div>
        <RoleChip role={role} />
        {canEditRole && !editingRole && !confirmingRemove && (
          <button
            type="button"
            onClick={() => setEditingRole(true)}
            disabled={busy}
            aria-label={`Change role for ${displayName}`}
            className={
              "rounded-soft p-1.5 text-text-soft transition-colors duration-base ease-out-soft " +
              "hover:bg-canvas hover:text-text-strong " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
              "disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {canRemove && !confirmingRemove && !editingRole && (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
            aria-label={`Remove ${displayName}`}
            className={
              "rounded-soft p-1.5 text-text-soft transition-colors duration-base ease-out-soft " +
              "hover:bg-canvas hover:text-danger " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
              "disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {editingRole && (
        <div className="mt-3 rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-soft">
            Change role · {displayName}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {(["full", "approver", "watcher"] as Role[]).map((r) => {
              const selected = r === role;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleChangeRole(r)}
                  disabled={busy}
                  className={
                    "flex flex-col items-start gap-0.5 rounded-soft border p-2 text-left transition-[border-color,background-color] duration-base ease-out-soft " +
                    "disabled:cursor-not-allowed disabled:opacity-50 " +
                    (selected
                      ? "border-accent bg-accent/5 text-text-strong"
                      : "border-border-soft bg-surface-raised hover:border-accent/40")
                  }
                >
                  <span className="text-xs font-medium text-text-strong">
                    {ROLE_LABEL[r]}
                    {selected && (
                      <span className="ml-1 text-[10px] text-text-soft">
                        (current)
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] leading-snug text-text-soft">
                    {ROLE_HINT[r]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="text-text-soft">
              {updateRole.isPending
                ? "Updating…"
                : "You'll sign 2 wallet popups unless switching to/from watcher only."}
            </span>
            <button
              type="button"
              onClick={() => setEditingRole(false)}
              disabled={busy}
              className="text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmingRemove && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-soft border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
          <span className="text-text-strong">
            {role === "watcher"
              ? `Stop watching with ${displayName}?`
              : `Remove ${displayName} from ${walletDisplay}? You'll sign 2 wallet popups.`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={remove.isPending}
              className="text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              disabled={remove.isPending}
              className={
                "inline-flex items-center gap-1 rounded-full bg-danger px-3 py-1 text-[11px] font-medium text-white " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-danger/90 active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-60"
              }
            >
              {remove.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Removing…
                </>
              ) : (
                "Remove"
              )}
            </button>
          </div>
        </div>
      )}
    </motion.li>
  );
}

function RoleChip({ role }: { role: Role | "unknown" }) {
  // Self-describing labels — feedback: "at first I was confused
  // what 'Full' meant". Replacing with the verb makes the chip
  // legible without context.
  const styles =
    role === "full"
      ? "border-accent/30 bg-accent/10 text-accent"
      : role === "approver"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-border-soft bg-canvas text-text-soft";
  const label =
    role === "full"
      ? "Spend & approve"
      : role === "approver"
        ? "Approve only"
        : role === "watcher"
          ? "Watching"
          : "Member";
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium " +
        styles
      }
    >
      {label}
    </span>
  );
}

function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-border-soft" />
      <div className="flex-1 space-y-1.5">
        <div className="h-4 w-1/4 animate-pulse rounded bg-border-soft" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-border-soft" />
      </div>
    </div>
  );
}
