"use client";

// Live USD price feed.
//
// Fetches our own same-origin `/api/prices` endpoint for the chains
// we support, writes the numbers into the module-scoped
// `_LIVE_PRICES_USD` map in `priceConversion.ts`, and refreshes every
// 60 seconds (CoinGecko's free tier permits 30 req/min, well within
// budget). Mounted once at the app root via `<LivePricesProvider/>`
// so every `quotePerWhole()` consumer in the app reads live numbers
// without each page having to wire its own fetch.
//
// Why CoinGecko: free tier requires no API key and covers every
// ticker the app knows about (SOL/ETH/BTC/ZEC/USDC). The browser no
// longer talks to CoinGecko directly, so we avoid CORS failures on
// `clearsig.xyz`. For higher reliability we can layer a failover to a
// paid Pyth/Chainlink read here without changing the public surface.
//
// Failure mode: if the fetch errors (rate-limit, transient outage),
// React Query retries with backoff and the UI keeps using whatever
// price was last seen, or the static fallback if no fetch ever
// succeeded. We never block render on the price feed.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { _setLivePrice } from "./priceConversion";

const PRICES_API_URL = "/api/prices";

interface CoinGeckoResponse {
  [coinId: string]: { usd?: number };
}

async function fetchPricesFromCoinGecko(): Promise<Record<string, number>> {
  const resp = await fetch(PRICES_API_URL, {
    method: "GET",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Prices API HTTP ${resp.status}`);
  }
  return (await resp.json()) as Record<string, number>;
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
