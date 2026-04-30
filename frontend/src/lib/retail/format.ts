// Retail-facing currency formatters.
//
// Earlier we treated $1 ≈ 1 SOL because no oracle was wired. That
// was a placeholder; real retail apps display the chain-native
// ticker. This module surfaces SOL/ETH/BTC/ZEC properly per the
// chain's smallest-unit base, and keeps a single source of truth so
// the wallet detail hero, dashboard cards, send hero, and any future
// per-chain surface render consistently.

import { CHAIN_CATALOG, type ChainMeta } from "@/lib/retail/chains";

const SOLANA = CHAIN_CATALOG[0];

export interface FormattedAmount {
  /// Display number, decimal-formatted with the chain's preferred
  /// precision and locale-grouped ("1,234.5678"). Excludes ticker
  /// and symbol so callers can compose layout independently.
  amount: string;
  /// Three-letter chain ticker — "SOL" / "ETH" / "BTC" / "ZEC".
  ticker: string;
  /// Currency-style glyph for visual punch — ◎ Ξ ₿ ⓩ.
  symbol: string;
}

/// Convert a smallest-unit value (lamports / wei / sats / zats) to a
/// retail-friendly amount card. Defaults to Solana — the primary
/// chain — but accepts any catalog entry.
export function formatBalance(
  smallestUnit: number,
  chain: ChainMeta = SOLANA,
): FormattedAmount {
  // Number arithmetic is safe for Solana lamports (max ~9e15 fits in
  // a double mantissa). When ETH wei (1e18-base) lands, switch the
  // ETH branch to BigInt division.
  const whole = smallestUnit / Number(chain.smallestPerWhole);
  return {
    amount: whole.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: chain.displayDecimals,
    }),
    ticker: chain.ticker,
    symbol: chain.symbol,
  };
}

/// Inverse of `formatBalance` — take a user-typed whole-unit string
/// (e.g. "0.5") and return the smallest-unit string the on-chain
/// program expects. Used by /send to convert the typed SOL amount
/// into lamports for the proposal params.
export function wholeToSmallestString(
  whole: string,
  chain: ChainMeta = SOLANA,
): string {
  const n = parseFloat(whole);
  if (isNaN(n) || n < 0) return "0";
  return Math.round(n * Number(chain.smallestPerWhole)).toString();
}
