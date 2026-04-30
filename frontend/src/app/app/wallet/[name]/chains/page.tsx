"use client";

// Chains — every chain this wallet can act on.
//
// Each binding is an Ika dWallet under the hood (one per chain), but
// the retail framing is "chains your wallet supports" — Solana,
// Ethereum, Bitcoin, Zcash. The technical mechanism (DKG, MPC,
// dWallets) lives only in the Settings / Details panel, never on
// this page.
//
// Solana is implicit on every wallet (the program runs there). Other
// chains are added one at a time via /chains/add, which pops the
// dWallet network's DKG ceremony — a ~30-second setup. After that,
// the wallet can send on that chain.

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listChainBindings } from "@/lib/chain/chainBindings";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  CHAIN_CATALOG,
  chainByKind,
  type ChainMeta,
} from "@/lib/retail/chains";

export default function ChainsPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const { connection } = useConnection();
  const reduce = useReducedMotion();

  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });

  const bindingsQuery = useQuery({
    queryKey: ["wallet-chains", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      return listChainBindings(connection, walletQuery.data.pda);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  // Derive what's bound vs what's still available to add. Solana is
  // always there implicitly — even before any IkaConfig accounts
  // exist for it, Clear's program runs on Solana and the wallet's
  // vault is a Solana PDA, so we surface it as a permanent first
  // entry in the bound list.
  const { bound, available } = useMemo(() => {
    const seenKinds = new Set<number>(
      bindingsQuery.data?.map((b) => b.chainKind) ?? [],
    );
    seenKinds.add(0); // Solana is always implicit.
    const bound = CHAIN_CATALOG.filter((c) => seenKinds.has(c.kind));
    const available = CHAIN_CATALOG.filter((c) => !seenKinds.has(c.kind));
    return { bound, available };
  }, [bindingsQuery.data]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

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
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Chains
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          {name} can send on
        </h1>
        <p className="mt-2 max-w-md text-base text-text-soft">
          Add support for more chains so this wallet can move money on
          each. Adding a chain takes about 30 seconds and only happens
          once per chain.
        </p>
      </motion.section>

      {/* Already bound */}
      <section>
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Active
        </h2>
        {bindingsQuery.isLoading ? (
          <div className="mt-3 space-y-2">
            <ChainRowSkeleton />
            <ChainRowSkeleton />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {bound.map((chain, i) => (
              <ActiveChainRow
                key={chain.kind}
                chain={chain}
                delay={i * 0.04}
                reduce={!!reduce}
                isImplicit={chain.kind === 0}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Available to add */}
      {available.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            Add support for
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {available.map((chain, i) => (
              <AvailableChainRow
                key={chain.kind}
                chain={chain}
                walletName={name}
                delay={i * 0.04}
                reduce={!!reduce}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Active chain row ──────────────────────────────────────────────

interface ActiveChainRowProps {
  chain: ChainMeta;
  delay: number;
  reduce: boolean;
  isImplicit: boolean;
}

function ActiveChainRow({
  chain,
  delay,
  reduce,
  isImplicit,
}: ActiveChainRowProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
    >
      <ChainBadge chain={chain} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-strong">
          {chain.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-text-soft">
          {chain.description}
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        {isImplicit ? "Built in" : "Active"}
      </span>
    </motion.li>
  );
}

// ─── Available chain row ───────────────────────────────────────────

interface AvailableChainRowProps {
  chain: ChainMeta;
  walletName: string;
  delay: number;
  reduce: boolean;
}

function AvailableChainRow({
  chain,
  walletName,
  delay,
  reduce,
}: AvailableChainRowProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=${chain.apiName}`}
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <ChainBadge chain={chain} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-strong">
            Add {chain.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-soft">
            {chain.description}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-text-soft transition-colors duration-base ease-out-soft group-hover:text-accent">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </Link>
    </motion.li>
  );
}

function ChainRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-border-soft" />
      <div className="flex-1 space-y-1.5">
        <div className="h-4 w-1/4 animate-pulse rounded bg-border-soft" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-border-soft" />
      </div>
    </div>
  );
}
