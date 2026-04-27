"use client";

// "My organizations" panel. Visual summary of every multisig the
// connected wallet has a role in. Each card deep-links to the wallet
// detail page at /app/wallet/<name>.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Loader2, ShieldCheck, Users, Wallet } from "lucide-react";
import { CardShell } from "@/components/ui/CardShell";
import { fetchOnchainMemberships, type OnchainMembership } from "@/lib/memberships/client";

export function MyOrganizationsCard() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";

  const myOrganizationsQuery = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 5_000,
  });

  if (!wallet.connected) {
    return null;
  }

  return (
    <CardShell title="Organizations" subtitle="Multisig wallets where this address has a role">
      <AnimatePresence initial={false} mode="wait">
        {myOrganizationsQuery.isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-20 items-center justify-center gap-2 text-sm text-text-muted"
          >
            <Loader2 size={14} className="animate-spin" /> Scanning chain…
          </motion.div>
        ) : myOrganizationsQuery.isError ? (
          <motion.p
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-rose-300"
          >
            Failed to load memberships.
          </motion.p>
        ) : (myOrganizationsQuery.data ?? []).length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center"
          >
            <p className="text-sm text-text-muted">
              No organization yet. Create your first multisig below.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(myOrganizationsQuery.data ?? []).map((o) => (
              <OrgCard key={o.wallet} organization={o} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </CardShell>
  );
}

function OrgCard({ organization }: { organization: OnchainMembership }) {
  const name = organization.wallet_name || organization.wallet;
  const hasName = Boolean(organization.wallet_name);
  const roles = organization.roles ?? [];

  return (
    <Link
      href={hasName ? `/app/wallet/${encodeURIComponent(organization.wallet_name!)}` : "#"}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-brand-green/40 hover:bg-white/[0.04]"
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-green/10 blur-2xl transition-opacity group-hover:opacity-60" />

      <div className="relative z-10 flex items-start gap-3">
        <div className="rounded-lg bg-brand-green/15 p-2 text-brand-green">
          <Wallet size={14} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold text-brand-white">{name}</span>
            {hasName && (
              <ArrowRight
                size={14}
                className="shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-green"
              />
            )}
          </div>
          {!hasName && (
            <span className="font-mono text-[10px] text-white/40">
              {shortPda(organization.wallet)}
            </span>
          )}
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => (
              <span
                key={r}
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  r === "approver"
                    ? "bg-brand-green/15 text-brand-green"
                    : "bg-sky-400/15 text-sky-300",
                ].join(" ")}
              >
                {r === "approver" ? <ShieldCheck size={9} /> : <Users size={9} />}
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

function shortPda(s: string): string {
  if (!s) return "·";
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}
