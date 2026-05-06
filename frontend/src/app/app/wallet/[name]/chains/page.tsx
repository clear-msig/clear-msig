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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { ArrowLeft, Check, Copy, Plus } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { appConfig } from "@/lib/config";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { ChainBadge } from "@/components/retail/ChainBadge";
import {
  CHAIN_CATALOG,
  chainByKind,
  type ChainMeta,
} from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  chainAddress,
  useWalletChains,
} from "@/lib/hooks/useWalletChains";
import type { ChainBindingResponse } from "@/lib/api/types";
import { fetchChainBalance, formatChainBalance } from "@/lib/balances";

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

  // Solana vault PDA — always rendered with the "Built in" badge
  // since Clear's program runs on Solana and the wallet's vault is
  // derivable client-side without an IkaConfig binding.
  const solanaAddress = useMemo(() => {
    if (!walletQuery.data) return null;
    const [vault] = findVaultAddress(
      walletQuery.data.pda,
      CLEAR_WALLET_PROGRAM_ID,
    );
    return vault.toBase58();
  }, [walletQuery.data]);

  // Backend-API list — returns ChainBindingResponse[] with the
  // chain-native addresses already derived (0x… / bc1q… / t1…).
  const bindingsQuery = useWalletChains(name);

  // Index bindings by chain_kind so each ActiveChainRow can look up
  // its address without re-scanning the array.
  const bindingByKind = useMemo(() => {
    const m = new Map<number, ChainBindingResponse>();
    for (const b of bindingsQuery.data?.chains ?? []) m.set(b.chain_kind, b);
    return m;
  }, [bindingsQuery.data]);

  const { bound, available } = useMemo(() => {
    const seenKinds = new Set<number>(
      bindingsQuery.data?.chains.map((b) => b.chain_kind) ?? [],
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
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Chains" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
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
            {bound.map((chain, i) => {
              const binding = bindingByKind.get(chain.kind);
              const address =
                chain.kind === 0
                  ? solanaAddress
                  : binding
                    ? chainAddress(binding)
                    : null;
              return (
                <ActiveChainRow
                  key={chain.kind}
                  chain={chain}
                  binding={binding ?? null}
                  address={address}
                  delay={i * 0.04}
                  reduce={!!reduce}
                  isImplicit={chain.kind === 0}
                />
              );
            })}
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
  binding: ChainBindingResponse | null;
  address: string | null;
  delay: number;
  reduce: boolean;
  isImplicit: boolean;
}

function ActiveChainRow({
  chain,
  binding,
  address,
  delay,
  reduce,
  isImplicit,
}: ActiveChainRowProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } };
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const { connection } = useConnection();

  // Live balance at the address shown above. Solana = vault PDA
  // balance (where SOL transfers come out of, see execute_custom in
  // the program). Other chains = balance at the dWallet's chain-
  // native address. Refetched every 30 s; errors render as a quiet
  // "—" rather than a toast (balance is informational, not blocking).
  const balanceQuery = useQuery({
    queryKey: ["chain-balance", chain.kind, address ?? "no-addr"],
    queryFn: () => loadBalance(chain.kind, address!, binding, connection),
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const balanceLabel =
    balanceQuery.data === undefined
      ? null
      : balanceQuery.data === null
        ? null
        : formatChainBalance(
            balanceQuery.data,
            chain.smallestPerWhole,
            chain.displayDecimals,
          );

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  const shortAddr = address
    ? `${address.slice(0, 6)}…${address.slice(-6)}`
    : null;

  return (
    <motion.li
      {...motionProps}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
    >
      <div className="flex items-center gap-3">
        <ChainBadge chain={chain} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-strong">
            {chain.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-soft">
            {chain.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {isImplicit ? "Built in" : "Active"}
          </span>
          {address && (
            <span className="text-xs tabular-nums text-text-soft">
              {balanceQuery.isLoading ? (
                <span aria-label="Loading balance">…</span>
              ) : balanceLabel !== null ? (
                <>
                  <span className="font-medium text-text-strong">
                    {balanceLabel}
                  </span>{" "}
                  {chain.ticker}
                </>
              ) : balanceQuery.isError ? (
                <span title="Couldn’t fetch balance from the chain RPC">—</span>
              ) : (
                <span title="No public balance source for this chain yet">
                  —
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {address ? (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={
            copied
              ? `${chain.name} address copied`
              : `Copy ${chain.name} address`
          }
          className={
            "group flex w-full items-center justify-between gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2 " +
            "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest active:scale-[0.98] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <span className="truncate text-left font-mono text-xs text-text-strong">
            {shortAddr}
          </span>
          <span
            className={
              "flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors duration-base ease-out-soft " +
              (copied ? "text-accent" : "text-text-soft group-hover:text-accent")
            }
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" strokeWidth={3} />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </span>
        </button>
      ) : (
        <p className="text-xs text-text-soft">
          Address pending. Refresh once the dWallet finishes spinning up.
        </p>
      )}
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

/// Pick the right balance source for the row.
///
/// Solana (kind 0) shows the **vault PDA** balance — that's where
/// SOL transfers come out of (the program's `execute_custom`
/// handler operates on the vault). Other chains show the balance at
/// the dWallet's chain-native address, fetched via lib/balances.
async function loadBalance(
  chainKind: number,
  address: string,
  binding: ChainBindingResponse | null,
  connection: Connection,
): Promise<bigint | null> {
  if (chainKind === 0) {
    const lamports = await connection.getBalance(
      new PublicKey(address),
      "confirmed",
    );
    return BigInt(lamports);
  }
  if (!binding) return null;
  const result = await fetchChainBalance(binding, {
    solanaConnection: connection,
    evmRpcUrl: appConfig.preAlpha.destinationRpcUrl,
  });
  return result?.raw ?? null;
}
