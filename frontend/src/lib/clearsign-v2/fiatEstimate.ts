import { quotePerWhole } from "@/lib/retail/priceConversion";

/**
 * Capture only a live USD quote for signed ClearSign text. Static fallback
 * prices are useful for layout continuity but must never be presented as the
 * market value a signer reviewed.
 */
export function liveUsdEstimate(
  humanAmount: string,
  ticker: string,
): string | undefined {
  const amount = Number(humanAmount.trim());
  const quote = quotePerWhole(ticker);
  if (!Number.isFinite(amount) || amount <= 0 || quote?.source !== "live") {
    return undefined;
  }
  const usd = amount * quote.usdPerWhole;
  if (!Number.isFinite(usd) || usd < 0) return undefined;
  return usd.toFixed(2);
}
