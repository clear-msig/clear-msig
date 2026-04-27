"use client";

// Intent workflow hook.
//
// Reads: direct-RPC batched `getMultipleAccountsInfo` . one roundtrip
// to fetch the wallet's entire intent table. No backend dependency.
// Writes (add/remove/update): relayer's `/prepare/**` routes until
// Phase 5 wires up the full signMessage flow.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { backendApiLegacy } from "@/lib/api/endpoints";
import type { AddIntentInput } from "@/lib/api/types";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents, type IntentWithPda } from "@/lib/chain/intents";

export function useIntentWorkflow(walletName: string) {
  const { connection } = useConnection();

  const listQuery = useQuery<IntentWithPda[]>({
    queryKey: ["intents", walletName],
    queryFn: async () => {
      const wallet = await fetchWalletByName(connection, walletName);
      if (!wallet) return [];
      return listIntents(connection, wallet.pda, wallet.account.intentIndex);
    },
    enabled: walletName.trim().length > 0,
    staleTime: 15_000,
  });

  const addMutation = useMutation({
    mutationFn: (input: AddIntentInput) => backendApiLegacy.addIntent(walletName, input),
    onSuccess: async () => {
      await listQuery.refetch();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (index: number) => backendApiLegacy.removeIntent(walletName, index),
    onSuccess: async () => {
      await listQuery.refetch();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: AddIntentInput & { index: number }) =>
      backendApiLegacy.updateIntent(walletName, input),
    onSuccess: async () => {
      await listQuery.refetch();
    },
  });

  return {
    listQuery,
    addMutation,
    removeMutation,
    updateMutation,
  };
}
