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
//
// Currency display: USD is the canonical reasoning unit (budgets,
// policy thresholds, internal math). The user can pick a display
// fiat in Settings — formatFiat / lamportsToFiat read that pref and
// convert at format time. The internal USD numbers stay USD-pinned
// so a budget cap of "$1,000" doesn't drift when the user switches
// display currencies.

const STATIC_PRICES_USD: Readonly<Record<string, number>> = {
  SOL: 200,
  ETH: 3500,
  BTC: 90000,
  ZEC: 30,
  USDC: 1,
};

// Static USD→fiat cross rates. As with the spot prices above,
// these are demo numbers — wired to the same oracle whenever a
// real price feed lands. The choice of currencies covers the
// common ones a treasury team would want; we deliberately don't
// ship 30 obscure ones because the pref is display-only.
const STATIC_FX_PER_USD: Readonly<Record<DisplayCurrency, number>> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 156,
  NGN: 1650,
  AUD: 1.5,
};

export type DisplayCurrency = "USD" | "EUR" | "GBP" | "JPY" | "NGN" | "AUD";

export const ALL_DISPLAY_CURRENCIES: DisplayCurrency[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "NGN",
  "AUD",
];

const CURRENCY_PREF_KEY = "clear.display-currency.v1";

export function getDisplayCurrency(): DisplayCurrency {
  if (typeof window === "undefined") return "USD";
  try {
    const raw = window.localStorage.getItem(CURRENCY_PREF_KEY);
    if (
      raw === "USD" ||
      raw === "EUR" ||
      raw === "GBP" ||
      raw === "JPY" ||
      raw === "NGN" ||
      raw === "AUD"
    ) {
      return raw;
    }
  } catch {
    /* fallthrough */
  }
  return "USD";
}

export function setDisplayCurrency(currency: DisplayCurrency): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURRENCY_PREF_KEY, currency);
    // Same-tab notification — `storage` only fires on other tabs.
    window.dispatchEvent(new Event("clear:display-currency-changed"));
  } catch {
    /* quota / private mode — silently noop */
  }
}

export function subscribeDisplayCurrency(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("clear:display-currency-changed", handler);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CURRENCY_PREF_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("clear:display-currency-changed", handler);
    window.removeEventListener("storage", onStorage);
  };
}

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

/// Render a USD-denominated value in the user's chosen display
/// currency. Internal math stays USD-pinned (budgets, policies); use
/// this only for display surfaces. Currency arg is optional — when
/// omitted, reads the active pref.
export function formatFiat(usd: number, currency?: DisplayCurrency): string {
  const cur = currency ?? getDisplayCurrency();
  if (cur === "USD") return formatUsd(usd);
  if (!isFinite(usd)) {
    return `${currencySymbol(cur)}—`;
  }
  const rate = STATIC_FX_PER_USD[cur];
  const local = usd * rate;
  // JPY is conventionally rendered without decimals; same trick we
  // use for "above $100, no cents" — let the locale-aware formatter
  // pick the right number of digits.
  const fractionDigits = cur === "JPY" ? 0 : local >= 100 ? 0 : 2;
  return new Intl.NumberFormat(currencyLocale(cur), {
    style: "currency",
    currency: cur,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(local);
}

/// Convert a chain-native bigint amount to the user's display
/// currency in one step. Equivalent to lamportsToUsd → formatFiat
/// for callers that don't need the intermediate USD number.
export function lamportsToFiat(
  amount: bigint,
  smallestPerWhole: bigint,
  ticker: string,
  currency?: DisplayCurrency,
): string {
  const usd = lamportsToUsd(amount, smallestPerWhole, ticker);
  return formatFiat(usd, currency);
}

export function currencyLabel(currency: DisplayCurrency): string {
  switch (currency) {
    case "USD":
      return "US Dollar";
    case "EUR":
      return "Euro";
    case "GBP":
      return "British Pound";
    case "JPY":
      return "Japanese Yen";
    case "NGN":
      return "Nigerian Naira";
    case "AUD":
      return "Australian Dollar";
  }
}

export function currencySymbol(currency: DisplayCurrency): string {
  switch (currency) {
    case "USD":
    case "AUD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "JPY":
      return "¥";
    case "NGN":
      return "₦";
  }
}

function currencyLocale(currency: DisplayCurrency): string {
  switch (currency) {
    case "USD":
    case "AUD":
      return "en-US";
    case "EUR":
      return "de-DE";
    case "GBP":
      return "en-GB";
    case "JPY":
      return "ja-JP";
    case "NGN":
      return "en-NG";
  }
}
