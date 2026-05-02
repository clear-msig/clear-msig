"use client";

// useWalletBudgetUsage. Folds the wallet's executed proposals into:
//   - Wallet-wide rolling-week USD total.
//   - Per-chain rolling-week USD totals (Solana, Ethereum, Bitcoin,
//     Zcash) so each chain's cap can render its own progress bar.
//   - Sends-in-the-last-24h count for the velocity check.
//
// Today only SolTransfer is decoded (the only shipped Custom intent).
// When TokenTransfer / EvmTransfer / etc. land, extend the
// `decodeProposalSpend()` switch with per-template decoders. The
// price oracle is a single swap point in `lib/retail/priceConversion.ts`.
//
// Returns null `budget` when the user hasn't set one, so the caller
// renders a "set a budget" CTA instead of a meaningless "0% used"
// bar. Per-chain caps default to undefined; the UI only renders
// progress bars for chains the user has explicitly capped.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  listProposalsForWallet,
  type ProposalWithPda,
} from "@/lib/chain/proposals";
import { ProposalStatus } from "@/lib/msig";
import {
  computeVelocityWindowStart,
  computeWindowStart,
  countWindowSends,
  getBudget,
  POLICY_CHAIN_TICKERS,
  sumWindowUsd,
  sumWindowUsdByChain,
  type PolicyChainTicker,
  type PriceableSpend,
  type WalletBudget,
} from "@/lib/retail/spendingBudget";
import { lamportsToUsd } from "@/lib/retail/priceConversion";

/// Per-chain breakdown for one ticker. `cap === null` means the user
/// hasn't capped this chain; the UI hides the progress bar but the
/// `spentUsd` is still useful for the sign-time impact preview.
export interface ChainBudgetUsage {
  ticker: PolicyChainTicker;
  spentUsd: number;
  cap: number | null;
  /// Difference between cap and spent. `null` when no cap is set;
  /// negative when overspent.
  remainingUsd: number | null;
  /// 0..1 fraction (clamped). `null` when no cap is set.
  pctUsed: number | null;
}

export interface BudgetUsageResult {
  budget: WalletBudget | null;
  /// Wallet-wide totals.
  spentUsd: number;
  proposalCount: number;
  remainingUsd: number | null;
  pctUsed: number | null;
  /// Per-chain totals for every ticker we know how to price (one
  /// entry per ticker in POLICY_CHAIN_TICKERS, even when the user
  /// hasn't set a cap and hasn't spent on that chain).
  perChain: ChainBudgetUsage[];
  /// Sends executed in the last 24h (the velocity window).
  sendsLast24h: number;
  /// True if velocityPerDay is set and sendsLast24h is at or above it.
  velocityHit: boolean;
  loading: boolean;
}

const SOL_LAMPORTS_PER_WHOLE = 1_000_000_000n;

export function useWalletBudgetUsage(walletName: string): BudgetUsageResult {
  const { connection } = useConnection();

  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const proposalsQuery = useQuery({
    queryKey: ["proposals", walletName],
    queryFn: async () => {
      if (!walletQuery.data) return [] as ProposalWithPda[];
      return listProposalsForWallet(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  const budget = useMemo(() => getBudget(walletName), [walletName]);

  const computed = useMemo(() => {
    const rows = proposalsQuery.data ?? [];
    // Only executed proposals "count" against caps. Active / Approved
    // are intent, not spend.
    const executed = rows.filter(
      (r) => r.account.status === ProposalStatus.Executed,
    );

    const dollarRows: PriceableSpend[] = executed.flatMap((r) => {
      const spend = decodeProposalSpend(r);
      // proposedAt is a good-enough proxy for executedAt; approve-then-
      // execute is usually within minutes.
      const executedAtMs = Number(r.account.proposedAt) * 1000;
      return spend ? [{ ...spend, executedAtMs }] : [];
    });

    const totals = sumWindowUsd(dollarRows);
    const perChainSpend = sumWindowUsdByChain(dollarRows);
    const sendsLast24h = countWindowSends(
      executed.map((r) => ({
        executedAtMs: Number(r.account.proposedAt) * 1000,
      })),
    );

    return { totals, perChainSpend, sendsLast24h };
  }, [proposalsQuery.data]);

  const cap = budget?.weeklyUsd ?? null;
  const remainingUsd = cap !== null ? cap - computed.totals.spentUsd : null;
  const pctUsed =
    cap !== null && cap > 0
      ? Math.max(0, Math.min(1, computed.totals.spentUsd / cap))
      : cap === 0
        ? 1
        : null;

  const perChain: ChainBudgetUsage[] = POLICY_CHAIN_TICKERS.map((ticker) => {
    const spent = computed.perChainSpend[ticker] ?? 0;
    const chainCap = budget?.perChainUsd?.[ticker] ?? null;
    const remaining = chainCap !== null ? chainCap - spent : null;
    const pct =
      chainCap !== null && chainCap > 0
        ? Math.max(0, Math.min(1, spent / chainCap))
        : chainCap === 0
          ? 1
          : null;
    return { ticker, spentUsd: spent, cap: chainCap, remainingUsd: remaining, pctUsed: pct };
  });

  const velocityCap = budget?.velocityPerDay ?? null;
  const velocityHit =
    velocityCap !== null && velocityCap > 0 && computed.sendsLast24h >= velocityCap;

  return {
    budget,
    spentUsd: computed.totals.spentUsd,
    proposalCount: computed.totals.proposalCount,
    remainingUsd,
    pctUsed,
    perChain,
    sendsLast24h: computed.sendsLast24h,
    velocityHit,
    loading: walletQuery.isLoading || proposalsQuery.isLoading,
  };
}

/// Sanity ceiling for any single decoded send. Devnet test wallets
/// often hold proposals from earlier debug iterations with absurd
/// lamport values (typing a SOL amount as if it were lamports yields
/// 1e9× the intended size). Without a clamp those entries dominate
/// the budget tracker and produce numbers like "$113M spent" on a
/// fresh-looking demo. We treat anything above this threshold as
/// devnet noise and exclude it from the cumulative spent.
const SANITY_CEILING_USD = 1_000_000;

/// Decode `paramsData` into a `{usd, ticker}` pair. Returns null for
/// templates we don't know how to read yet (gracefully degrade; the
/// budget stripe is a hint, not enforcement). Add cases as new chain
/// transfer templates land.
function decodeProposalSpend(
  p: ProposalWithPda,
): { usd: number; ticker: PolicyChainTicker } | null {
  const data = p.account.paramsData;
  // SolTransfer layout: 32-byte destination + 8-byte u64 lamports
  // (LE) + 32-byte nonce. Anything shorter than 40 bytes can't be
  // SolTransfer.
  if (data.length < 40) return null;
  const view = new DataView(data.buffer, data.byteOffset + 32, 8);
  const lamports = view.getBigUint64(0, true);
  const usd = lamportsToUsd(lamports, SOL_LAMPORTS_PER_WHOLE, "SOL");
  if (usd <= 0) return null;
  if (usd > SANITY_CEILING_USD) {
    // Almost certainly leftover devnet noise. Don't count it.
    if (typeof console !== "undefined") {
      console.debug(
        `[budget] skipping implausibly large send (${usd.toFixed(2)} USD) ` +
          `from proposal ${p.pda.toBase58()}`,
      );
    }
    return null;
  }
  return { usd, ticker: "SOL" };
}

/// Re-export so consumers don't need a second import for the constant.
export { computeWindowStart, computeVelocityWindowStart };
