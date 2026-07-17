"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import { fetchErc20Holdings, tokenAmountToString } from "@/lib/chain/erc20";
import {
  fetchSolanaTokenHoldings,
  type SolanaTokenHolding,
} from "@/lib/chain/solanaTokens";
import { useSendChains } from "@/lib/hooks/useSendChains";

export function HeldAssetPicker({
  walletName,
  activeKind,
}: {
  walletName: string;
  activeKind: number | null;
}) {
  const { connection } = useConnection();
  const { options } = useSendChains(walletName);
  const solanaAddress = options.find((option) => option.chain.kind === 0)?.address;
  const evmAddress = options.find((option) => option.chain.kind === 1)?.address;
  const showSolana = activeKind === 0;
  const showEvm = activeKind === 1 || activeKind === 4;

  const solanaQuery = useQuery({
    queryKey: ["solana-token-holdings", solanaAddress ?? ""],
    queryFn: () => fetchSolanaTokenHoldings(connection, solanaAddress!),
    enabled: showSolana && !!solanaAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const evmQuery = useQuery({
    queryKey: ["erc20-holdings", evmAddress ?? ""],
    queryFn: () => fetchErc20Holdings(evmAddress!),
    enabled: showEvm && !!evmAddress,
    staleTime: 60_000,
    refetchInterval: 90_000,
    retry: 1,
  });

  const solanaRows = solanaQuery.data ?? [];
  const evmRows = evmQuery.data ?? [];
  if (solanaRows.length === 0 && evmRows.length === 0) return null;

  return (
    <section className="mt-2" aria-label="Assets held on this network">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        Held on this network
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {evmRows.map((holding) => (
          <Link
            key={holding.contractAddress}
            href={
              `/app/wallet/${encodeURIComponent(walletName)}/send/erc20?token=` +
              encodeURIComponent(holding.contractAddress)
            }
            className="flex h-12 min-w-36 shrink-0 items-center gap-2 rounded-soft border border-border-soft bg-surface-raised px-3 transition-colors hover:border-accent/40"
          >
            <AssetSymbol symbol={holding.symbol} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-text-strong">
                {holding.symbol}
              </span>
              <span className="block truncate text-[10px] text-text-soft">
                {tokenAmountToString(holding.rawBalance, holding.decimals, 6)} held
              </span>
            </span>
          </Link>
        ))}
        {solanaRows.map((holding) => (
          <SolanaHeldAsset key={holding.tokenAccount} holding={holding} />
        ))}
      </div>
    </section>
  );
}

function SolanaHeldAsset({ holding }: { holding: SolanaTokenHolding }) {
  return (
    <div
      className="flex h-12 min-w-36 shrink-0 items-center gap-2 rounded-soft border border-border-soft bg-surface-raised px-3"
      title="This asset is held by the Solana vault. Typed SPL sending is not enabled yet."
    >
      <AssetSymbol symbol={holding.symbol} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-text-strong">
          {holding.symbol}
        </span>
        <span className="block truncate text-[10px] text-text-soft">
          {tokenAmountToString(holding.rawBalance, holding.decimals, 6)} held
        </span>
      </span>
    </div>
  );
}

function AssetSymbol({ symbol }: { symbol: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold uppercase text-accent">
      {symbol.slice(0, 4)}
    </span>
  );
}
