"use client";

// Live USD price feed.
//
// Fetches CoinGecko's `/simple/price` endpoint for the chains we
// support, writes the numbers into the module-scoped
// `_LIVE_PRICES_USD` map in `priceConversion.ts`, and refreshes every
// 60 seconds (CoinGecko's free tier permits 30 req/min — well within
// budget). Mounted once at the app root via `<LivePricesProvider/>`
// so every `quotePerWhole()` consumer in the app reads live numbers
// without each page having to wire its own fetch.
//
// Why CoinGecko: free tier requires no API key, supports CORS for
// browser origins, and covers every ticker the app knows about
// (SOL/ETH/BTC/ZEC/USDC). For higher reliability we can layer a
// failover to a paid Pyth/Chainlink read here without changing the
// public surface.
//
// Failure mode: if the fetch errors (rate-limit, transient outage),
// React Query retries with backoff and the UI keeps using whatever
// price was last seen — or the static fallback if no fetch ever
// succeeded. We never block render on the price feed.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { _setLivePrice } from "./priceConversion";

/// CoinGecko `id` → app ticker. Adding a chain means adding its
/// CoinGecko id here; the fetch picks it up automatically. The id
/// is the slug from `https://api.coingecko.com/api/v3/coins/list` —
/// e.g. Solana = "solana", Bitcoin = "bitcoin", USDC = "usd-coin".
const COINGECKO_IDS: Readonly<Record<string, string>> = {
  solana: "SOL",
  ethereum: "ETH",
  bitcoin: "BTC",
  zcash: "ZEC",
  "usd-coin": "USDC",
};

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?" +
  `ids=${Object.keys(COINGECKO_IDS).join(",")}` +
  "&vs_currencies=usd";

interface CoinGeckoResponse {
  [coinId: string]: { usd?: number };
}

async function fetchPricesFromCoinGecko(): Promise<Record<string, number>> {
  const resp = await fetch(COINGECKO_URL, {
    method: "GET",
    // Don't send cookies; CoinGecko's CORS is permissive but `omit`
    // makes it explicit + lets the browser cache the preflight.
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`CoinGecko HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as CoinGeckoResponse;
  const out: Record<string, number> = {};
  for (const [coinId, ticker] of Object.entries(COINGECKO_IDS)) {
    const usd = json[coinId]?.usd;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
      out[ticker] = usd;
    }
  }
  return out;
}

/// React-Query-backed live-price subscription. Mount once at the app
/// root (the provider does this for you). Re-fetches every 60s while
/// the tab is visible; stale-while-revalidate on focus so a returning
/// user sees fresh numbers without waiting.
export function useLivePrices() {
  const query = useQuery<Record<string, number>>({
    queryKey: ["live-prices-coingecko-v1"],
    queryFn: fetchPricesFromCoinGecko,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
    // Important: never let a stale-while-loading flicker swap a live
    // number for the static fallback. We use the React state hook
    // below to write into the module map and never clear it.
  });

  useEffect(() => {
    if (!query.data) return;
    for (const [ticker, usd] of Object.entries(query.data)) {
      _setLivePrice(ticker, usd);
    }
  }, [query.data]);

  return query;
}

/// Mounts `useLivePrices()` once; renders nothing. Intended to sit
/// inside the QueryClient + Layout tree so it has access to the
/// React Query context and runs for every page.
export function LivePricesProvider() {
  useLivePrices();
  return null;
}
