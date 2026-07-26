"use client";

// Inline fiat hint shown next to a chain-native token amount.
//
// Renders "≈ $185" using the existing priceConversion library. Live
// CoinGecko-fed numbers when available (LivePricesProvider mounts at
// app root), static demo numbers as fallback while the first fetch
// is in flight. Respects the user's display-currency pref. Toggling
// USD → EUR in Settings reflows every hint without a reload.
//
// Returns null when the ticker isn't priced in either map so a stray
// SPL never paints as a misleading "$0". Callers can layout against
// that absence (no extra separator, no empty span).
//
// Two layout variants:
//   inline (default): " · ≈ $185" with a leading separator so the
//                     hint sits next to the token amount on the same
//                     line.
//   plain:            "≈ $185" no separator. For stacked layouts
//                      where the parent positions the hint on its
//                      own line.

import {
  lamportsToFiat,
  quotePerWhole,
} from "@/lib/retail/priceConversion";
import { useDisplayCurrency } from "@/lib/hooks/useDisplayCurrency";

interface UsdHintProps {
  /// Chain-native bigint amount (lamports / wei / sats / token base
  /// units). Pass 0n to opt out. The component renders nothing.
  amount: bigint;
  /// Smallest unit per whole token. 10^9 for SOL, 10^18 for ETH,
  /// 10^8 for BTC, 10^decimals for SPL / ERC-20 tokens.
  smallestPerWhole: bigint;
  /// Upper- or lower-case ticker that priceConversion knows about
  /// (SOL / ETH / BTC / ZEC / USDC). Unknown tickers render nothing.
  ticker: string;
  /// "inline" prepends " · " so it sits next to the token amount.
  /// "plain" omits the separator so the parent positions it.
  variant?: "inline" | "plain";
  /// Override the wrapper class. Defaults to a subdued tone matching
  /// the surrounding caption.
  className?: string;
}

export function UsdHint({
  amount,
  smallestPerWhole,
  ticker,
  variant = "inline",
  className,
}: UsdHintProps) {
  const { currency } = useDisplayCurrency();
  if (!quotePerWhole(ticker)) return null;
  if (amount === 0n) return null;
  const fiat = lamportsToFiat(amount, smallestPerWhole, ticker, currency);
  const wrapperClass = className ?? "text-text-soft";
  return (
    <span className={wrapperClass}>
      {variant === "inline" ? " · " : ""}≈ {fiat}
    </span>
  );
}
