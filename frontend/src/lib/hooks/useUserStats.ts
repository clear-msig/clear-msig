"use client";

// Cross-wallet portfolio stats for the dashboard hero. Reuses
// useRecentActivity's underlying queries (same cache keys), so
// fetching this is a derivation, not extra RPC.

import { useMemo } from "react";
import { useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { ProposalStatus } from "@/lib/msig";

export interface UserStats {
  walletCount: number;
  activeProposals: number;
  approvedProposals: number;
  executedProposals: number;
  totalProposals: number;
  loading: boolean;
}

const ONE_WEEK_SECS = 7 * 24 * 60 * 60;

export function useUserStats(): UserStats & {
  executedThisWeek: number;
} {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  // Pull all proposals (limit Infinity) so the counts are accurate,
  // not just over the recent-5 window.
  const all = useRecentActivity(Number.POSITIVE_INFINITY);

  return useMemo(() => {
    const counts = {
      walletCount: memberships.data?.length ?? 0,
      activeProposals: 0,
      approvedProposals: 0,
      executedProposals: 0,
      totalProposals: all.rows.length,
      executedThisWeek: 0,
      loading: memberships.isLoading || all.loading,
    };
    const cutoff = BigInt(Math.floor(Date.now() / 1000) - ONE_WEEK_SECS);
    for (const r of all.rows) {
      if (r.status === ProposalStatus.Active) counts.activeProposals++;
      else if (r.status === ProposalStatus.Approved) counts.approvedProposals++;
      else if (r.status === ProposalStatus.Executed) {
        counts.executedProposals++;
        if (r.proposedAt > cutoff) counts.executedThisWeek++;
      }
    }
    return counts;
  }, [memberships.data, memberships.isLoading, all.rows, all.loading]);
}
