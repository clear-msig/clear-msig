import { quotePerWhole } from "@/lib/retail/priceConversion";
import type { FiatEstimateInput } from "@/lib/clearsign/intentInput";

/**
 * Capture a timestamped live USD quote for canonical ClearSign review context.
 * Static fallback prices are useful for layout continuity but must never be
 * presented as the market value a signer reviewed.
 */
export function liveUsdEstimate(
  humanAmount: string,
  ticker: string,
): FiatEstimateInput | undefined {
  const amount = Number(humanAmount.trim());
  const quote = quotePerWhole(ticker);
  if (!Number.isFinite(amount) || amount <= 0 || quote?.source !== "live") {
    return undefined;
  }
  const usd = amount * quote.usdPerWhole;
  if (!Number.isFinite(usd) || usd < 0) return undefined;
  return {
    amount: usd.toFixed(2),
    currency: "USD",
    source: quote.sourceId,
    observedAt: quote.observedAt,
    informationalOnly: true,
  };
}
