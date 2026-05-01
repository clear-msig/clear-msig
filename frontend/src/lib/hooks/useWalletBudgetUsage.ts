"use client";

// useWalletBudgetUsage — folds the wallet's executed proposals into
// a rolling-week USD total + compares against the locally-stored
// weekly cap.
//
// Today this only knows how to decode SolTransfer params (the only
// shipped Custom intent). When other chain templates land
// (TokenTransfer, EvmTransfer, etc), extend `usdForProposal()` with
// per-template decoders. The price oracle is a single swap point in
// `lib/retail/priceConversion.ts`.
//
// Returns null `budget` when the user hasn't set one — caller
// renders a "set a budget" CTA in that case rather than a meaningless
// "0% used" bar.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  listProposalsForWallet,
  type ProposalWithPda,
} from "@/lib/chain/proposals";
import { ProposalStatus } from "@/lib/msig";
import {
  computeWindowStart,
  getBudget,
  sumWindowUsd,
  type WalletBudget,
} from "@/lib/retail/spendingBudget";
import { lamportsToUsd } from "@/lib/retail/priceConversion";

export interface BudgetUsageResult {
  budget: WalletBudget | null;
  spentUsd: number;
  proposalCount: number;
  /// Difference between cap and spent. `null` when no budget is set;
  /// can be negative when the user has overspent.
  remainingUsd: number | null;
  /// 0–1 fraction (clamped). `null` when no budget is set.
  pctUsed: number | null;
  loading: boolean;
}

const SOL_LAMPORTS_PER_WHOLE = 1_000_000_000n;

export function useWalletBudgetUsage(walletName: string): BudgetUsageResult {
  const { connection } = useConnection();

  // Read the wallet's full proposal list; the rolling-window filter
  // happens in-memory so we can swap the window length without
  // re-querying the chain.
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

  // Re-read budget from storage on every render — tiny + lets the
  // setter page reflect changes without a full re-mount of the
  // consumer.
  const budget = useMemo(() => getBudget(walletName), [walletName]);

  const usage = useMemo(() => {
    const rows = proposalsQuery.data ?? [];
    // Only executed proposals "count" against the weekly limit —
    // active / approved are intent, not spend.
    const executed = rows.filter(
      (r) => r.account.status === ProposalStatus.Executed,
    );
    const dollarRows = executed.flatMap((r) => {
      const usd = usdForProposal(r);
      // The proposal carries `proposedAt` (seconds) but no separate
      // `executedAt`. Approve-then-execute is usually within
      // minutes, so proposedAt is a good-enough cohort marker for a
      // 7-day window.
      const executedAtMs = Number(r.account.proposedAt) * 1000;
      return usd > 0 ? [{ executedAtMs, usd }] : [];
    });
    return sumWindowUsd(dollarRows);
  }, [proposalsQuery.data]);

  const cap = budget?.weeklyUsd ?? null;
  const remainingUsd = cap !== null ? cap - usage.spentUsd : null;
  const pctUsed =
    cap !== null && cap > 0
      ? Math.max(0, Math.min(1, usage.spentUsd / cap))
      : cap === 0
        ? 1
        : null;

  return {
    budget,
    spentUsd: usage.spentUsd,
    proposalCount: usage.proposalCount,
    remainingUsd,
    pctUsed,
    loading: walletQuery.isLoading || proposalsQuery.isLoading,
  };
}

/// Decode `paramsData` into a USD value. Returns 0 for templates
/// we don't know how to read yet (gracefully degrade — the budget
/// stripe is a hint, not an enforcement). Add cases as new chain
/// transfer templates land.
function usdForProposal(p: ProposalWithPda): number {
  const data = p.account.paramsData;
  // SolTransfer layout: 32-byte destination + 8-byte u64 lamports
  // (LE) + 32-byte nonce. Anything shorter than 40 bytes can't be
  // SolTransfer, so we bail.
  if (data.length < 40) return 0;
  // u64 little-endian read. DataView reads up to bigint via
  // getBigUint64; jsdom in Vitest supports it, browsers do too.
  const view = new DataView(
    data.buffer,
    data.byteOffset + 32,
    8,
  );
  const lamports = view.getBigUint64(0, true);
  return lamportsToUsd(lamports, SOL_LAMPORTS_PER_WHOLE, "SOL");
}

/// Re-export so consumers don't need a second import for the constant.
export { computeWindowStart };
