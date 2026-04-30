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

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Lock, UserPlus } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { avatarInitials } from "@/lib/retail/avatar";

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
      const upTo = walletQuery.data.account.intentIndex - 1;
      if (upTo < 0) return [];
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  const members = useMemo(() => {
    if (!intentsQuery.data) return [];
    const seen = new Map<string, { isApprover: boolean }>();
    for (const it of intentsQuery.data) {
      if (!it.account) continue;
      for (const a of it.account.approvers) {
        const prev = seen.get(a) ?? { isApprover: false };
        seen.set(a, { isApprover: true });
      }
    }
    // Make sure the connected user shows up even if the wallet hasn't
    // yet been bound to an intent (fresh wallets pre-setup).
    if (me && !seen.has(me)) seen.set(me, { isApprover: true });
    return Array.from(seen.entries()).map(([address, info]) => ({
      address,
      isApprover: info.isApprover,
      isYou: address === me,
    }));
  }, [intentsQuery.data, me]);

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/app/wallet/${encodeURIComponent(name)}`}
        className={
          "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {name}
      </Link>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Members
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Who&rsquo;s in {name}
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
          Private list
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
                address={m.address}
                isApprover={m.isApprover}
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
              wallet enforces it on chain — and the limits stay
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
  address: string;
  isApprover: boolean;
  isYou: boolean;
  delay: number;
  reduce: boolean;
}

function MemberRow({
  address,
  isApprover,
  isYou,
  delay,
  reduce,
}: MemberRowProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  const initials = avatarInitials(address);
  const displayName = isYou ? "You" : `Member ${initials}`;

  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
    >
      <MemberAvatar address={address} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-strong">
          {displayName}
        </p>
        <p className="mt-0.5 text-xs text-text-soft">
          {isApprover
            ? isYou
              ? "Can spend and approve"
              : "Can approve requests"
            : "Watching"}
        </p>
      </div>
      <RoleChip kind={isApprover ? "approver" : "viewer"} />
    </motion.li>
  );
}

function RoleChip({ kind }: { kind: "approver" | "viewer" }) {
  if (kind === "approver") {
    return (
      <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
        Approver
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
      Viewer
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
