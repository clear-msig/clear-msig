import { CHAIN_CATALOG } from "@/lib/retail/chains";
import { quotePerWhole } from "@/lib/retail/priceConversion";
import {
  POLICY_CHAIN_TICKERS,
  type PolicyChainTicker,
} from "@/lib/retail/spendingBudget";

type PriceResolver = (ticker: PolicyChainTicker) => number | null;

export function deriveNativeWeeklyCaps(
  weeklyUsd: number | null,
  perChainUsd: Partial<Record<PolicyChainTicker, number | null>>,
  resolveUsdPrice: PriceResolver = (ticker) =>
    quotePerWhole(ticker)?.usdPerWhole ?? null,
): Partial<Record<PolicyChainTicker, string | null>> {
  const caps: Partial<Record<PolicyChainTicker, string | null>> = {};
  for (const ticker of POLICY_CHAIN_TICKERS) {
    const candidates = [weeklyUsd, perChainUsd[ticker]].filter(
      (value): value is number => typeof value === "number" && value > 0,
    );
    const effectiveUsd = candidates.length > 0 ? Math.min(...candidates) : null;
    const usdPerWhole = resolveUsdPrice(ticker);
    const smallestPerWhole =
      CHAIN_CATALOG.find((chain) => chain.ticker === ticker)
        ?.smallestPerWhole ?? 100_000_000n;
    if (!effectiveUsd || !usdPerWhole || usdPerWhole <= 0) {
      caps[ticker] = null;
      continue;
    }

    const precision = Math.min(smallestPerWhole.toString().length - 1, 12);
    const scale = 10 ** precision;
    const native = Math.floor((effectiveUsd / usdPerWhole) * scale) / scale;
    caps[ticker] =
      native > 0
        ? native.toFixed(precision).replace(/\.?0+$/, "")
        : null;
  }
  return caps;
}
