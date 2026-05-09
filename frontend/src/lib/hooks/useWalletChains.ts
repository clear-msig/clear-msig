"use client";

// useWalletChains - typed wrapper around `GET /wallets/{name}/chains`.
//
// Returns chain bindings WITH their chain-native addresses (already
// derived by the CLI: Ethereum 0x…, Bitcoin bc1q…, Zcash t1…). Used
// by Receive to surface a per-chain address picker, and could feed
// future Send chain-selector logic.

import { useQuery } from "@tanstack/react-query";
import { backendApi } from "@/lib/api/endpoints";
import type {
  ChainBindingResponse,
  WalletChainsResponse,
} from "@/lib/api/types";

export function useWalletChains(walletName: string) {
  return useQuery<WalletChainsResponse>({
    queryKey: ["wallet-chains-api", walletName],
    queryFn: () => backendApi.listWalletChains(walletName),
    enabled: walletName.trim().length > 0,
    staleTime: 30_000,
  });
}

/// Pick the right chain-native address from a binding for Receive
/// display. Returns null if the binding doesn't yet have an address
/// (e.g. dWallet not finished spinning up).
export function chainAddress(binding: ChainBindingResponse): string | null {
  switch (binding.chain_kind) {
    case 0:
      return binding.solana_address ?? null;
    case 1:
    case 4:
      return binding.evm_address ?? null;
    case 2:
      return (
        binding.btc_p2wpkh_mainnet ?? binding.btc_p2wpkh_testnet ?? null
      );
    case 3:
      return (
        binding.zcash_t_addr_mainnet ?? binding.zcash_t_addr_testnet ?? null
      );
    default:
      return null;
  }
}
