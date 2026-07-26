"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { UsdHint } from "@/components/retail/UsdHint";
import {
  fetchErc20Holdings,
  tokenAmountToString,
  type Erc20Holding,
} from "@/lib/chain/erc20";
import {
  chainSendActionLabel,
  type ChainSendStatus,
} from "@/lib/chain/send-support";
import { useSendChains } from "@/lib/hooks/useSendChains";
import { chainAddress, useWalletChains } from "@/lib/hooks/useWalletChains";
import type { WalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { CHAIN_CATALOG } from "@/lib/retail/chains";
import { formatUsd } from "@/lib/retail/priceConversion";

export interface HoldingsPanelProps {
  walletName: string;
  portfolio: WalletPortfolio;
  reduce: boolean;
}

export function HoldingsPanel({
  walletName,
  portfolio,
  reduce,
}: HoldingsPanelProps) {
  const chains = useWalletChains(walletName);
  const evmAddress = useMemo(() => {
    const binding = (chains.data?.chains ?? []).find(
      (chain) =>
        chain.chain_kind === 1 ||
        chain.chain_kind === 4 ||
        chain.chain_kind === 5,
    );
    return binding ? chainAddress(binding) : null;
  }, [chains.data]);
  const erc20 = useQuery({
    queryKey: ["erc20-holdings", evmAddress ?? ""],
    queryFn: () => fetchErc20Holdings(evmAddress!),
    enabled: !!evmAddress,
    staleTime: 60_000,
    refetchInterval: 90_000,
    retry: 1,
  });
  const erc20Holdings = erc20.data ?? [];
  return (
    <div
      id="wallet-tab-panel-holdings"
      role="tabpanel"
      aria-labelledby="wallet-tab-holdings"
      className="flex flex-col gap-4"
    >
      <NativeHoldings
        walletName={walletName}
        rows={portfolio.breakdown}
        loading={portfolio.isLoading}
        reduce={reduce}
      />
      {erc20Holdings.length > 0 ? (
        <Erc20Holdings
          walletName={walletName}
          rows={erc20Holdings}
          reduce={reduce}
        />
      ) : null}
    </div>
  );
}

function NativeHoldings({
  walletName,
  rows,
  loading,
  reduce,
}: {
  walletName: string;
  rows: WalletPortfolio["breakdown"];
  loading: boolean;
  reduce: boolean;
}) {
  const encoded = encodeURIComponent(walletName);
  const { options } = useSendChains(walletName);
  const readinessByKind = useMemo(() => {
    const map = new Map<number, (typeof options)[number]>();
    for (const option of options) map.set(option.chain.kind, option);
    return map;
  }, [options]);

  return (
    <motion.section
      initial={reduce ? undefined : { opacity: 0, y: 8 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">Assets</h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <HoldingsEmptyState walletName={walletName} />
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => {
            const meta = CHAIN_CATALOG.find((chain) => chain.kind === row.kind);
            const sendStatus = readinessByKind.get(row.kind)?.status ?? null;
            const amount =
              row.raw !== null && meta
                ? formatChainAmount(
                    row.raw,
                    meta.smallestPerWhole,
                    meta.displayDecimals,
                  )
                : null;
            const sendHref =
              meta && sendStatus
                ? nativeHoldingSendHref(
                    encoded,
                    row.kind,
                    meta.apiName,
                    sendStatus,
                  )
                : null;
            const receiveHref = meta
              ? `/app/wallet/${encoded}/receive?chain=${encodeURIComponent(meta.apiName)}`
              : `/app/wallet/${encoded}/receive`;
            return (
              <li
                key={row.kind}
                className="flex min-w-0 items-center gap-3 rounded-soft border border-border-soft bg-canvas/70 p-3"
              >
                {meta ? (
                  <ChainBadge chain={meta} size="md" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-600 text-xs font-semibold text-white"
                  >
                    {row.ticker.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-text-strong">
                      {row.name}
                    </p>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-text-soft">
                      {row.ticker}
                    </span>
                  </div>
                  <p className="mt-0.5 font-numerals text-sm tabular-nums text-text-soft">
                    {amount ??
                      (loading ? "Reading balance" : "Check network balance")}
                    {amount ? ` ${row.ticker}` : ""}
                    {typeof row.usd === "number" ? (
                      <span className="ml-1.5 text-xs text-text-soft/80">
                        {formatUsd(row.usd)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <AssetAction href={receiveHref} label={`Receive ${row.ticker}`}>
                    Receive
                  </AssetAction>
                  {sendHref ? (
                    <AssetAction href={sendHref} label={`Send ${row.ticker}`}>
                      {sendStatus ? chainSendActionLabel(sendStatus) : "Send"}
                    </AssetAction>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

function HoldingsEmptyState({ walletName }: { walletName: string }) {
  const encoded = encodeURIComponent(walletName);
  return (
    <div className="mt-4 py-6 text-center">
      <p className="text-sm font-medium text-text-strong">No assets yet</p>
      <p className="mt-1 text-xs text-text-soft">
        Deposits and activated networks will appear here.
      </p>
      <Link
        href={`/app/wallet/${encoded}/receive`}
        className="mt-4 inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        Receive money
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Erc20Holdings({
  walletName,
  rows,
  reduce,
}: {
  walletName: string;
  rows: Erc20Holding[];
  reduce: boolean;
}) {
  const encoded = encodeURIComponent(walletName);
  return (
    <motion.section
      initial={reduce ? undefined : { opacity: 0, y: 8 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">Tokens</h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((holding) => {
          const display = tokenAmountToString(
            holding.rawBalance,
            holding.decimals,
            6,
          );
          const sendHref =
            `/app/wallet/${encoded}/send/erc20?token=` +
            encodeURIComponent(holding.contractAddress);
          const receiveHref = `/app/wallet/${encoded}/receive?chain=evm_1559`;
          return (
            <li
              key={holding.contractAddress}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold uppercase text-accent">
                {holding.symbol.slice(0, 3)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-strong">
                  {holding.name}
                  <span className="ml-1.5 text-xs font-normal text-text-soft">
                    ({holding.symbol})
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs tabular-nums text-text-soft">
                  {display} {holding.symbol}
                  <UsdHint
                    amount={holding.rawBalance}
                    smallestPerWhole={10n ** BigInt(holding.decimals)}
                    ticker={holding.symbol}
                  />
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <AssetAction
                  href={receiveHref}
                  label={`Receive ${holding.symbol}`}
                >
                  Receive
                </AssetAction>
                <AssetAction href={sendHref} label={`Send ${holding.symbol}`}>
                  Send
                </AssetAction>
              </div>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}

function AssetAction({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-surface-raised px-3 text-[11px] font-medium text-text-strong transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
    >
      {children}
    </Link>
  );
}

function nativeHoldingSendHref(
  encodedWalletName: string,
  kind: number,
  apiName: string,
  status: ChainSendStatus,
): string | null {
  if (status === "coming_soon") return null;
  if (status === "needs_binding") {
    return `/app/wallet/${encodedWalletName}/chains/add?chain=${encodeURIComponent(apiName)}&autostart=1`;
  }
  if (kind === 0) return `/app/wallet/${encodedWalletName}/send`;
  if (kind === 1) {
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/setup/eth?autostart=1`
      : `/app/wallet/${encodedWalletName}/send/eth`;
  }
  if (kind === 2 || kind === 3) {
    const ticker = kind === 2 ? "btc" : "zec";
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/send/${ticker}?autostart=1`
      : `/app/wallet/${encodedWalletName}/send/${ticker}`;
  }
  if (kind === 5) {
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/setup/eth?network=hyperliquid&autostart=1`
      : `/app/wallet/${encodedWalletName}/send/eth?network=hyperliquid`;
  }
  return null;
}

function formatChainAmount(
  raw: bigint,
  smallestPerWhole: bigint,
  displayDecimals: number,
): string {
  if (raw === 0n) return "0";
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / smallestPerWhole;
  const fraction = abs - whole * smallestPerWhole;
  if (displayDecimals === 0 || fraction === 0n) {
    return `${negative ? "-" : ""}${whole}`;
  }
  const wholeDigits = smallestPerWhole.toString().length - 1;
  const fractionText = fraction.toString().padStart(wholeDigits, "0");
  const truncated = fractionText.slice(0, displayDecimals).replace(/0+$/, "");
  return truncated.length === 0
    ? `${negative ? "-" : ""}${whole}`
    : `${negative ? "-" : ""}${whole}.${truncated}`;
}
