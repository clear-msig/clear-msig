import { decodeSegwitAddress } from "@/lib/chain/btc";
import { isValidEvmAddress } from "@/lib/chain/eth";
import { networkForZcashAddress } from "@/lib/chain/zcash";
import { isValidSolanaAddress } from "@/lib/retail/contacts";
import type { PersistWalletPolicyResult } from "@/lib/hooks/usePersistWalletPolicy";

export const ALLOWLIST_CHAINS = [
  { chainKind: 0, ticker: "SOL", label: "Solana" },
  { chainKind: 1, ticker: "ETH", label: "Ethereum" },
  { chainKind: 2, ticker: "BTC", label: "Bitcoin" },
  { chainKind: 3, ticker: "ZEC", label: "Zcash" },
  { chainKind: 5, ticker: "HYPE", label: "Hyperliquid" },
] as const;

export function allowlistChain(chainKind: number) {
  return (
    ALLOWLIST_CHAINS.find((chain) => chain.chainKind === chainKind) ??
    ALLOWLIST_CHAINS[0]
  );
}

export function normalizeAllowlistAddress(
  chainKind: number,
  address: string,
): string {
  const trimmed = address.trim();
  return chainKind === 1 || chainKind === 2 || chainKind === 5
    ? trimmed.toLowerCase()
    : trimmed;
}

export function isValidAllowlistAddress(
  chainKind: number,
  address: string,
): boolean {
  if (chainKind === 0) return isValidSolanaAddress(address);
  if (chainKind === 1 || chainKind === 5) return isValidEvmAddress(address);
  if (chainKind === 2) {
    const decoded = decodeSegwitAddress(address);
    return decoded?.version === 0 && decoded.program.length === 20;
  }
  if (chainKind === 3) return networkForZcashAddress(address) !== null;
  return false;
}

export function formatPolicySyncResult(
  result: PersistWalletPolicyResult,
): string {
  return [
    result.updated > 0
      ? `${result.updated} on-chain ${result.updated === 1 ? "rule" : "rules"} updated`
      : "On-chain rules already matched",
    result.waiting > 0
      ? `${result.waiting} ${result.waiting === 1 ? "update is" : "updates are"} waiting for another approval`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
