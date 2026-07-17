import type { BitcoinNetwork } from "@/lib/chain/btc";

export function btcBalanceStatusLabel(
  error: Error | null | undefined,
  _network: BitcoinNetwork,
): string {
  if (!error) return "Balance unavailable";
  const message = error.message.toLowerCase();
  if (message.includes("404")) return "No Bitcoin found";
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Balance unavailable";
  }
  if (message.includes("429") || message.includes("rate")) {
    return "Balance temporarily unavailable";
  }
  if (message.includes("500") || message.includes("502") || message.includes("503")) {
    return "Balance temporarily unavailable";
  }
  return "Check balance";
}
