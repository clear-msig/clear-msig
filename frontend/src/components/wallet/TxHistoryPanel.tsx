"use client";

// Per-wallet transaction history.
//
// Lists the latest 25 signatures hitting the wallet PDA via Solana
// `getSignaturesForAddress`. Each row is a fly-in row with a relative
// timestamp + Explorer link. Failed txs render with a rose marker.
//
// Data source: direct RPC. No backend dependency. Refetches every 30s
// so the user sees newly confirmed txs without manual reload.

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import type { ConfirmedSignatureInfo, PublicKey } from "@solana/web3.js";
import { AlertTriangle, Activity, CheckCircle2, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { CardShell } from "@/components/ui/CardShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { txUrl } from "@/lib/explorer";
import { relativeTime } from "@/lib/util/relativeTime";

export function TxHistoryPanel({ walletPda }: { walletPda: PublicKey }) {
  const { connection } = useConnection();

  const query = useQuery<ConfirmedSignatureInfo[]>({
    queryKey: ["wallet-tx-history", walletPda.toBase58()],
    queryFn: () => connection.getSignaturesForAddress(walletPda, { limit: 25 }, "confirmed"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (query.isLoading) {
    return (
      <CardShell title="Activity" subtitle="Recent on-chain transactions for this wallet">
        <div className="flex flex-col gap-2">
          <Skeleton tone="dark" className="h-14 rounded-2xl" />
          <Skeleton tone="dark" className="h-14 rounded-2xl" />
          <Skeleton tone="dark" className="h-14 rounded-2xl" />
        </div>
      </CardShell>
    );
  }

  if (query.error) {
    return (
      <CardShell title="Activity" subtitle="Recent on-chain transactions for this wallet">
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load activity"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Solana RPC didn't respond. Try again in a moment."
          }
        />
      </CardShell>
    );
  }

  const txs = query.data ?? [];

  if (txs.length === 0) {
    return (
      <CardShell title="Activity" subtitle="Recent on-chain transactions for this wallet">
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Once proposals are created or chains are bound, transactions will surface here. Sourced from Solana RPC for the wallet PDA."
        />
      </CardShell>
    );
  }

  return (
    <CardShell title="Activity" subtitle="Recent on-chain transactions for this wallet">
      <ul className="flex flex-col gap-1">
        {txs.map((s, i) => (
          <TxRow key={s.signature} sig={s} index={i} />
        ))}
      </ul>
    </CardShell>
  );
}

function TxRow({ sig, index }: { sig: ConfirmedSignatureInfo; index: number }) {
  const failed = sig.err !== null;
  const time = sig.blockTime ? new Date(sig.blockTime * 1000) : null;

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.4) }}
      className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04] sm:px-4 sm:py-3"
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          failed ? "bg-rose-500/15 text-rose-400" : "bg-brand-green/15 text-brand-green"
        }`}
        aria-hidden="true"
      >
        {failed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-xs text-white/80">
          {shortSig(sig.signature)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-white/40">
          {time ? relativeTime(time) : `slot ${sig.slot}`}
          {failed ? " · failed" : ""}
        </span>
      </div>

      <a
        href={txUrl(sig.signature)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-brand-green transition-colors hover:bg-brand-green/15"
      >
        Explorer <ExternalLink size={10} />
      </a>
    </motion.li>
  );
}

function shortSig(s: string): string {
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

