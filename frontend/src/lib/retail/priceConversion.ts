"use client";

// USD price conversion — single swap point for a real oracle.
//
// The cross-chain spending budget needs to compare apples to apples.
// "5 SOL" and "0.001 BTC" are different sizes; only when both land
// on dollars can we sum them and check against a weekly cap.
//
// **This is a stub.** The numbers are static demo prices, hand-set
// for the pre-alpha demo. They WILL be wrong against the live
// market — anyone reading "$200/SOL" should treat it as a sketch,
// not a quote. When the network is live, swap `quotePerWhole()` for
// a Pyth read, a CoinGecko fetch, or whatever oracle ships in the
// price feeds workstream. Every consumer in the app reads through
// this single function so the swap is a one-line change.
//
// Tickers are upper-case three-letter strings matching ChainMeta.ticker
// (so "SOL", "ETH", "BTC", "ZEC", "USDC"). Unknown tickers return
// null — callers decide whether to treat that as $0 or skip.

const STATIC_PRICES_USD: Readonly<Record<string, number>> = {
  SOL: 200,
  ETH: 3500,
  BTC: 90000,
  ZEC: 30,
  USDC: 1,
};

export interface PriceQuote {
  /// USD per one whole token (1 SOL, 1 ETH, etc).
  usdPerWhole: number;
  /// Marker so callers can render "demo price" UI affordances.
  source: "demo";
}

/// Lookup the current USD price per whole unit. Returns null when
/// the ticker isn't in our known set (e.g. an exotic SPL the wallet
/// happens to hold) — callers decide whether to fall through.
export function quotePerWhole(ticker: string): PriceQuote | null {
  const usd = STATIC_PRICES_USD[ticker.toUpperCase()];
  if (typeof usd !== "number") return null;
  return { usdPerWhole: usd, source: "demo" };
}

/// Convert a chain-native bigint amount (lamports, wei, satoshis)
/// to a USD number using the static price map. Returns 0 for
/// unknown tickers so a budget summation doesn't crash on a stray
/// SPL — but `quotePerWhole(ticker)` is the right call when the UI
/// needs to know the conversion was real vs zero-by-default.
export function lamportsToUsd(
  amount: bigint,
  smallestPerWhole: bigint,
  ticker: string,
): number {
  const q = quotePerWhole(ticker);
  if (!q) return 0;
  // Avoid bigint→Number precision blowup on very large amounts by
  // doing the division in the bigint domain first, then folding the
  // remainder back as a fraction.
  if (smallestPerWhole === 0n) return 0;
  const whole = Number(amount / smallestPerWhole);
  const rem = Number(amount % smallestPerWhole) / Number(smallestPerWhole);
  return (whole + rem) * q.usdPerWhole;
}

/// Render a USD amount with sensible rounding. Always shows the $
/// prefix, no fractional cents above $100, two decimals below.
export function formatUsd(usd: number): string {
  if (!isFinite(usd)) return "$—";
  if (usd >= 100) {
    return `$${Math.round(usd).toLocaleString("en-US")}`;
  }
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
