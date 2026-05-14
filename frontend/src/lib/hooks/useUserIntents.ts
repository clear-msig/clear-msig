"use client";

// Cross-wallet intent listing for the connected user. Mirrors
// useRecentActivity's pattern: memberships → per-wallet account →
// per-wallet intents, flattened. Used by the Cmd-K palette to make
// every intent searchable.

import { useMemo } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { PublicKey } from "@solana/web3.js";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchOnchainMemberships,
  type OnchainMembership,
} from "@/lib/memberships/client";
import { fetchWalletByPda } from "@/lib/chain/wallets";
import { listIntents, type IntentWithPda } from "@/lib/chain/intents";
import type { WalletAccount } from "@/lib/msig";

export interface UserIntentRow {
  walletPda: string;
  walletName: string;
  intentIndex: number;
  template: string;
  chainKind: number;
  approved: boolean;
  intentType: number;
  approvers: string[];
  approvalThreshold: number;
}

export function useUserIntents() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const address = wallet.publicKey?.toBase58() ?? "";

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

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

  const intentsQueries = useQueries({
    queries: walletQueries.map((wq) => {
      const ready = wq.data?.account != null;
      return {
        queryKey: [
          "wallet-intents-all",
          wq.data?.membership.wallet ?? "pending",
        ],
        queryFn: async (): Promise<{
          membership: OnchainMembership;
          rows: IntentWithPda[];
        }> => {
          const m = wq.data!.membership;
          const wAccount = wq.data!.account!;
          const rows = await listIntents(
            connection,
            new PublicKey(m.wallet),
            wAccount.intentIndex
          );
          return { membership: m, rows };
        },
        enabled: ready,
        staleTime: 15_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      };
    }),
  });

  // useQueries returns a fresh array each render - keying the memo
  // off the array ref means it re-runs even when nothing changed.
  // Fingerprint by per-query dataUpdatedAt so we recompute only on
  // actual fetch updates. This matters because useActionNeeded ->
  // BottomNav reads downstream state on every page render.
  const intentsFingerprint = intentsQueries
    .map((q) => `${q.dataUpdatedAt}.${q.status}`)
    .join("|");
  const rows = useMemo<UserIntentRow[]>(() => {
    const flat: UserIntentRow[] = [];
    for (const q of intentsQueries) {
      if (!q.data) continue;
      const m = q.data.membership;
      for (const r of q.data.rows) {
        if (!r.account) continue;
        flat.push({
          walletPda: m.wallet,
          walletName: m.wallet_name ?? m.wallet.slice(0, 8),
          intentIndex: r.index,
          template: r.account.template,
          chainKind: r.account.chainKind,
          approved: r.account.approved,
          intentType: r.account.intentType,
          approvers: r.account.approvers,
          approvalThreshold: r.account.approvalThreshold,
        });
      }
    }
    return flat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentsFingerprint]);

  const loading =
    memberships.isLoading ||
    walletQueries.some((q) => q.isLoading) ||
    intentsQueries.some((q) => q.isLoading);

  return { rows, loading };
}
