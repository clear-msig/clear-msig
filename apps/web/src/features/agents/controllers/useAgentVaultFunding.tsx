"use client";

import { useQuery } from "@tanstack/react-query";
import {
  loadAgentVaultAddress,
  loadProFundingSources,
} from "@/features/agents/infrastructure/vaultFundingClient";
import {
  useConnection,
  useWallet,
} from "@/features/agents/infrastructure/walletSigningClient";

export function useAgentVaultFunding(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const ownerAddress = wallet.publicKey?.toBase58() ?? "";
  const addressQuery = useQuery({
    queryKey: ["agent-vault-funding-wallet", walletName, ownerAddress],
    queryFn: () =>
      loadAgentVaultAddress(connection, walletName, wallet.publicKey),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const sourcesQuery = useQuery({
    queryKey: ["agent-vault-funding-sources", ownerAddress, walletName],
    queryFn: () => loadProFundingSources(ownerAddress, walletName),
    enabled: ownerAddress.length > 0,
    staleTime: 30_000,
  });

  return {
    vaultAddress: addressQuery.data ?? null,
    proSources: sourcesQuery.data ?? [],
    loadingAddress: addressQuery.isLoading,
  };
}
