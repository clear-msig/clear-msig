"use client";

// Wallet workflow hook.
//
// Reads go to Solana RPC directly (via `useConnection`), so the page
// stays usable if the backend relayer is down. Writes go to the backend
// because they need the relayer's sponsored-gas keypair to pay fees.
//
// Shape compatibility: the returned `walletQuery.data` / `chainsQuery.data`
// match what `backendApi.showWallet` / `listWalletChains` used to
// return, keyed by camelCase fields. Components that consumed the
// generic `Record<string, unknown>` shape still work; new components
// can consume the typed `WalletAccount` / `ChainBindingWithPda[]`.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import type { AddChainInput, CreateWalletInput } from "@/lib/api/types";
import { fetchWalletByName, type WalletWithPda } from "@/lib/chain/wallets";
import { listChainBindings, type ChainBindingWithPda } from "@/lib/chain/chainBindings";

export function useWalletWorkflow(walletName: string) {
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  // `healthQuery` stays on the backend . it's the liveness probe for
  // the relayer specifically, not for Solana RPC.
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: backendApi.health,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const walletQuery = useQuery<WalletWithPda | null>({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.trim().length > 0,
    // Avoid hammering RPC on every remount; 30s is plenty for a
    // single-wallet dashboard.
    staleTime: 30_000,
  });

  const chainsQuery = useQuery<ChainBindingWithPda[]>({
    queryKey: ["wallet-chains", walletName],
    queryFn: async () => {
      const wallet = await fetchWalletByName(connection, walletName);
      if (!wallet) return [];
      return listChainBindings(connection, wallet.pda);
    },
    enabled: walletName.trim().length > 0,
    // 10s instead of 30s so a freshly-added chain shows up promptly
    // even without a window-focus event. The Receive / Chains pages
    // also expose a refresh chip for manual bumps.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const createWalletMutation = useMutation({
    mutationFn: (input: CreateWalletInput) => backendApi.createWallet(input),
    onSuccess: async () => {
      await walletQuery.refetch();
      await chainsQuery.refetch();
    },
  });

  const addChainMutation = useMutation({
    mutationFn: (input: AddChainInput) => backendApi.addWalletChain(walletName, input),
    onSuccess: async () => {
      // The chain list lives in TWO query keys with different
      // sources of truth:
      //   - "wallet-chains" — read on chain via this hook's
      //     `chainsQuery` (Solana RPC `getProgramAccounts`).
      //   - "wallet-chains-api" — read via `useWalletChains` which
      //     hits backend-api `GET /wallets/{name}/chains`.
      // Pages mix both (Receive uses the API key; the wallet detail
      // uses the on-chain key). Invalidate BOTH so the new chain
      // appears immediately wherever the user lands next.
      await Promise.allSettled([
        chainsQuery.refetch(),
        queryClient.invalidateQueries({
          queryKey: ["wallet-chains-api", walletName],
        }),
        queryClient.invalidateQueries({
          queryKey: ["wallet-chains", walletName],
        }),
      ]);
    },
  });

  return {
    healthQuery,
    walletQuery,
    chainsQuery,
    createWalletMutation,
    addChainMutation,
  };
}
