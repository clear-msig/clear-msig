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

import { useMutation, useQuery } from "@tanstack/react-query";
import { useConnection } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import type { AddChainInput, CreateWalletInput } from "@/lib/api/types";
import { fetchWalletByName, type WalletWithPda } from "@/lib/chain/wallets";
import { listChainBindings, type ChainBindingWithPda } from "@/lib/chain/chainBindings";

export function useWalletWorkflow(walletName: string) {
  const { connection } = useConnection();

  // `healthQuery` stays on the backend . it's the liveness probe for
  // the relayer specifically, not for Solana RPC.
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: backendApi.health,
    refetchInterval: 30_000,
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
    staleTime: 30_000,
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
      await chainsQuery.refetch();
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
