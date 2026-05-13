"use client";

// Aggregate USD-denominated portfolio for a wallet across every
// bound chain.
//
// Modern wallets surface a single "wallet value" headline that's
// the sum of holdings across whatever chains/tokens the wallet
// has. clear-msig has been showing only the Solana vault balance
// in the hero - undersells multi-chain wallets, which is the
// product's actual differentiator.
//
// This hook fans out:
//   - Solana   : vault PDA balance (where execute_custom moves SOL
//                from). Read via web3.js connection.getBalance.
//   - Other    : dWallet's chain-native address balance via
//                lib/balances/index.ts::fetchChainBalance.
// Each chain's smallest-unit balance is multiplied by the static
// USD price from lib/retail/priceConversion::lamportsToUsd. Zcash
// and unknown tickers contribute $0 (there's no public price feed
// integration for ZEC yet); the `unknownPriceChains` field flags
// them so the UI can show "(+ZEC, value pending)" if it wants.
//
// Refetches every 30s on the same cadence as the per-chain rows
// on /chains, so a successful send anywhere triggers the whole
// portfolio to update.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection } from "@/lib/wallet";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { useWalletChains } from "@/lib/hooks/useWalletChains";
import { fetchChainBalance } from "@/lib/balances";
import { CHAIN_CATALOG, chainByKind } from "@/lib/retail/chains";
import { appConfig } from "@/lib/config";
import { lamportsToUsd, quotePerWhole } from "@/lib/retail/priceConversion";
import type { ChainBindingResponse } from "@/lib/api/types";

export interface PortfolioChain {
  kind: number;
  ticker: string;
  name: string;
  /// Raw balance in the chain's smallest unit (lamports / wei /
  /// sats). `null` when fetch is still in flight or the chain has
  /// no balance source we can hit.
  raw: bigint | null;
  /// USD value at the static price-conversion rate. `null` when we
  /// don't have a price feed (e.g. Zcash today).
  usd: number | null;
}

export interface WalletPortfolio {
  /// Sum of USD across every bound chain we have a price for.
  /// Zero while loading; chains without a price contribute zero.
  totalUsd: number;
  /// Per-chain breakdown for "Wallet has 0.5 SOL · 0.01 ETH" copy.
  /// Always includes Solana (every wallet runs there); other chains
  /// only when bound.
  breakdown: PortfolioChain[];
  /// True while at least one chain's balance query is still loading.
  /// Drives the "..." loading affordance in the hero.
  isLoading: boolean;
  /// Tickers we couldn't price (mostly ZEC). Lets the UI render
  /// "(value not shown)" instead of silently zeroing them.
  unknownPriceChains: string[];
}

export function useWalletPortfolio(walletName: string): WalletPortfolio {
  const { connection } = useConnection();

  // Solana wallet PDA - needed to derive the vault address.
  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });

  // Vault PDA balance - bigint for byte-accurate sums. Distinct
  // query key from the dashboard's `["wallet-balance", …]` (which
  // returns number) to avoid the same bigint↔number cache collision
  // we hit in send/page.tsx; share the data via shared `wallet`
  // key, but key the fetch separately.
  const solanaBalanceQuery = useQuery({
    queryKey: [
      "wallet-vault-balance-lamports",
      walletQuery.data?.pda.toBase58() ?? "",
    ],
    queryFn: async () => {
      if (!walletQuery.data) return 0n;
      const [vault] = findVaultAddress(
        walletQuery.data.pda,
        CLEAR_WALLET_PROGRAM_ID,
      );
      const lamports = await connection.getBalance(vault, "confirmed");
      return BigInt(lamports);
    },
    enabled: !!walletQuery.data,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  // Bound non-Solana chains.
  const chainsQuery = useWalletChains(walletName);

  // Per-chain balance for everything except Solana. Memoised by
  // (kind, address) so toggling between wallets re-fetches.
  const otherChainsBalanceQuery = useQuery({
    queryKey: [
      "wallet-other-chain-balances",
      walletName,
      (chainsQuery.data?.chains ?? [])
        .filter((b) => b.chain_kind !== 0)
        .map((b) => `${b.chain_kind}:${b.dwallet}`)
        .join("|"),
    ],
    queryFn: async () => {
      const bindings: ChainBindingResponse[] = chainsQuery.data?.chains ?? [];
      const out = new Map<number, bigint | null>();
      await Promise.all(
        bindings
          .filter((b) => b.chain_kind !== 0)
          .map(async (b) => {
            try {
              const result = await withTimeout(
                fetchChainBalance(b, {
                  solanaConnection: connection as unknown as Connection,
                  evmRpcUrl: appConfig.preAlpha.destinationRpcUrl,
                }),
                8000,
                `balance fetch timed out for chain ${b.chain_kind}`,
              );
              out.set(b.chain_kind, result?.raw ?? null);
            } catch {
              out.set(b.chain_kind, null);
            }
          }),
      );
      return out;
    },
    enabled: !!chainsQuery.data,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  return useMemo<WalletPortfolio>(() => {
    const breakdown: PortfolioChain[] = [];
    const unknownPriceChains: string[] = [];

    // Solana - always present.
    const solanaMeta = chainByKind(0);
    if (solanaMeta) {
      const raw = solanaBalanceQuery.data ?? null;
      const usd =
        raw !== null
          ? lamportsToUsd(raw, solanaMeta.smallestPerWhole, solanaMeta.ticker)
          : null;
      breakdown.push({
        kind: 0,
        ticker: solanaMeta.ticker,
        name: solanaMeta.name,
        raw,
        usd,
      });
    }

    // Other bound chains.
    const otherBalances = otherChainsBalanceQuery.data;
    const bindings: ChainBindingResponse[] = chainsQuery.data?.chains ?? [];
    for (const b of bindings) {
      if (b.chain_kind === 0) continue;
      const meta = chainByKind(b.chain_kind);
      if (!meta) continue;
      const raw = otherBalances?.get(b.chain_kind) ?? null;
      const priced = quotePerWhole(meta.ticker);
      const usd =
        raw !== null && priced !== null
          ? lamportsToUsd(raw, meta.smallestPerWhole, meta.ticker)
          : null;
      if (raw !== null && priced === null) {
        unknownPriceChains.push(meta.ticker);
      }
      breakdown.push({
        kind: b.chain_kind,
        ticker: meta.ticker,
        name: meta.name,
        raw,
        usd,
      });
    }

    const totalUsd = breakdown.reduce(
      (acc, c) => acc + (c.usd ?? 0),
      0,
    );
    const isLoading =
      walletQuery.isLoading ||
      solanaBalanceQuery.isLoading ||
      chainsQuery.isLoading ||
      otherChainsBalanceQuery.isLoading;

    return { totalUsd, breakdown, isLoading, unknownPriceChains };
  }, [
    solanaBalanceQuery.data,
    otherChainsBalanceQuery.data,
    chainsQuery.data,
    walletQuery.isLoading,
    solanaBalanceQuery.isLoading,
    chainsQuery.isLoading,
    otherChainsBalanceQuery.isLoading,
  ]);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Make `CHAIN_CATALOG` import non-dead - used implicitly via
// chainByKind, kept for future per-chain ordering.
void CHAIN_CATALOG;
