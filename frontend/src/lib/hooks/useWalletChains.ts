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
    // Was 30s. That meant a freshly-added chain could sit invisible
    // for half a minute even after the on-chain ix landed. 10s gives
    // a snappier "just added" experience without hammering the
    // backend on every focus event.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/// Pick the right chain-native address from a binding for Receive
/// display. Returns null if the binding doesn't yet have an address
/// (e.g. dWallet not finished spinning up).
///
/// Pre-alpha network preference: we run on Solana DEVNET, Ethereum
/// SEPOLIA, and Ika's pre-alpha mock signer (`pre-alpha-dev-1.ika.…`).
/// Showing a mainnet BTC / Zcash address would be actively harmful.
/// The dWallet's signing path can't produce a sig that real bitcoin
/// nodes would accept (Ika pre-alpha isn't the production signer),
/// so any user who funds the mainnet address would lose those coins.
/// We prefer the testnet/signet address and only fall back to mainnet
/// if no testnet address exists (which shouldn't happen in pre-alpha,
/// but the fallback keeps the receive page from rendering empty
/// rather than showing nothing).
export function chainAddress(binding: ChainBindingResponse): string | null {
  switch (binding.chain_kind) {
    case 0:
      return binding.solana_address ?? null;
    case 1:
    case 4:
      return binding.evm_address ?? null;
    case 2:
      return (
        binding.btc_p2wpkh_testnet ?? binding.btc_p2wpkh_mainnet ?? null
      );
    case 3:
      return (
        binding.zcash_t_addr_testnet ?? binding.zcash_t_addr_mainnet ?? null
      );
    default:
      return null;
  }
}
