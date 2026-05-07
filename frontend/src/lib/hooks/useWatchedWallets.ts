"use client";

// React hook that turns the localStorage watch list (raw names)
// into resolved on-chain wallet accounts the wallet hub can
// render alongside membership wallets.
//
// Each watched name is resolved via `fetchWalletByName`. We expose
// the result in `OnchainMembership`-like shape (with `roles: []`
// as the marker for "watching, not a member") so the existing
// WalletCard component renders it without bifurcating its
// rendering logic.
//
// Refresh: subscribes to the watched-wallets storage event so adds
// / removes from any tab refresh the list. Per-name fetches are
// react-query cached so adding a wallet that's already in the
// cache (because the user navigated through it) returns instantly.

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { type OnchainMembership } from "@/lib/memberships/client";
import {
  loadWatchedWallets,
  subscribe,
  type WatchedWallet,
} from "@/lib/retail/watchedWallets";

export interface WatchedMembership extends OnchainMembership {
  /// Always true for entries this hook returns — the wallet hub
  /// uses this to render a Watching badge.
  watching: true;
}

export function useWatchedWallets(): {
  rows: WatchedMembership[];
  loading: boolean;
} {
  const { connection } = useConnection();
  const [list, setList] = useState<WatchedWallet[]>([]);

  // Hydrate on mount + subscribe to the storage events the watch
  // module dispatches. We don't render the list during SSR — the
  // initial empty array is fine and the effect re-runs immediately
  // client-side.
  useEffect(() => {
    setList(loadWatchedWallets());
    return subscribe(() => setList(loadWatchedWallets()));
  }, []);

  const queries = useQueries({
    queries: list.map((w) => ({
      queryKey: ["watched-wallet", w.name],
      queryFn: () => fetchWalletByName(connection, w.name),
      staleTime: 30_000,
    })),
  });

  const rows: WatchedMembership[] = [];
  for (let i = 0; i < list.length; i++) {
    const q = queries[i];
    const data = q.data;
    if (!data) continue;
    rows.push({
      wallet: data.pda.toBase58(),
      wallet_name: list[i].name,
      roles: [],
      // intent_indexes seeds a per-wallet badge query that the
      // hub doesn't actually run for watched wallets — leaving
      // it as an empty array keeps the type contract intact
      // without a side query.
      intent_indexes: [],
      watching: true,
    });
  }
  // Newest-watched first so a freshly-added wallet sits at the top.
  rows.sort((a, b) => {
    const ta = list.find((w) => w.name === a.wallet_name)?.addedAt ?? 0;
    const tb = list.find((w) => w.name === b.wallet_name)?.addedAt ?? 0;
    return tb - ta;
  });

  return { rows, loading: queries.some((q) => q.isLoading) };
}
