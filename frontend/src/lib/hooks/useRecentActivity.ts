"use client";

// Cross-wallet "recent activity" feed for the connected user.
//
// For each wallet the user is a member of, fetches the wallet account
// (so we know intentIndex + proposalIndex) and then every proposal.
// Flattens the union, sorts by proposedAt desc, and returns the top N.
//
// Uses tanstack-query useQueries so each per-wallet fetch is cached and
// invalidated independently.

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchOnchainMemberships,
  type OnchainMembership,
} from "@/lib/memberships/client";
import { fetchWalletByPda } from "@/lib/chain/wallets";
import {
  listProposalsForWallet,
  type ProposalWithPda,
} from "@/lib/chain/proposals";
import type { WalletAccount } from "@/lib/msig";

export interface RecentActivityRow {
  walletPda: string;
  walletName: string;
  proposalPda: string;
  proposalIndex: bigint;
  intentIndex: number;
  status: ProposalWithPda["account"]["status"];
  statusLabel: ProposalWithPda["account"]["statusLabel"];
  proposedAt: bigint;
}

export function useRecentActivity(limit = 5) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const address = wallet.publicKey?.toBase58() ?? "";

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  // Per-wallet account fetches (cache-shared with the wallet detail
  // page when the user navigates into one).
  const walletQueries = useQueries({
    queries: (memberships.data ?? []).map((m) => ({
      queryKey: ["wallet-account-by-pda", m.wallet],
      queryFn: async (): Promise<{
        membership: OnchainMembership;
        account: WalletAccount | null;
      }> => {
        const account = await fetchWalletByPda(connection, new PublicKey(m.wallet));
        return { membership: m, account };
      },
      staleTime: 30_000,
    })),
  });

  // Per-wallet proposal lists, keyed by wallet PDA. Only fires once
  // the corresponding wallet-account query resolves.
  const proposalsQueries = useQueries({
    queries: walletQueries.map((wq) => {
      const ready = wq.data?.account != null;
      return {
        queryKey: [
          "wallet-proposals-recent",
          wq.data?.membership.wallet ?? "pending",
        ],
        queryFn: async (): Promise<{
          membership: OnchainMembership;
          rows: ProposalWithPda[];
        }> => {
          const m = wq.data!.membership;
          const wAccount = wq.data!.account!;
          const rows = await listProposalsForWallet(
            connection,
            new PublicKey(m.wallet),
            wAccount
          );
          return { membership: m, rows };
        },
        enabled: ready,
        staleTime: 15_000,
      };
    }),
  });

  const rows = useMemo<RecentActivityRow[]>(() => {
    const flat: RecentActivityRow[] = [];
    for (const q of proposalsQueries) {
      if (!q.data) continue;
      const m = q.data.membership;
      for (const p of q.data.rows) {
        flat.push({
          walletPda: m.wallet,
          walletName: m.wallet_name ?? m.wallet.slice(0, 8),
          proposalPda: p.pda.toBase58(),
          proposalIndex: p.proposalIndex,
          intentIndex: p.intentIndex,
          status: p.account.status,
          statusLabel: p.account.statusLabel,
          proposedAt: p.account.proposedAt,
        });
      }
    }
    // Sort by proposedAt desc; fall back to proposalIndex desc for
    // ties or zero timestamps from older deployments.
    flat.sort((a, b) => {
      if (a.proposedAt !== b.proposedAt) {
        return a.proposedAt > b.proposedAt ? -1 : 1;
      }
      return a.proposalIndex > b.proposalIndex ? -1 : 1;
    });
    return flat.slice(0, limit);
  }, [proposalsQueries, limit]);

  const loading =
    memberships.isLoading ||
    walletQueries.some((q) => q.isLoading) ||
    proposalsQueries.some((q) => q.isLoading);

  return { rows, loading };
}
