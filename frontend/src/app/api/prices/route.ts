import { NextResponse } from "next/server";

// Server-side CoinGecko proxy for the live USD price feed.
//
// The browser calls this same-origin route, and this route talks to
// CoinGecko from the server side. That avoids browser CORS failures
// while keeping the feed live.

const COINGECKO_IDS = ["solana", "ethereum", "bitcoin", "zcash", "usd-coin"] as const;
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?" +
  `ids=${COINGECKO_IDS.join(",")}` +
  "&vs_currencies=usd";
const FALLBACK_PRICES_USD: Record<string, number> = {
  SOL: 150,
  ETH: 3000,
  BTC: 90000,
  ZEC: 30,
  USDC: 1,
};

interface CoinGeckoResponse {
  [coinId: string]: { usd?: number };
}

export async function GET() {
  try {
    const resp = await fetch(COINGECKO_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.warn("[api/prices] CoinGecko fallback", {
        status: resp.status,
        detail: detail.slice(0, 200),
      });
      return fallbackPrices();
    }

    const json = (await resp.json()) as CoinGeckoResponse;
    const out: Record<string, number> = {};
    for (const [coinId, ticker] of Object.entries({
      solana: "SOL",
      ethereum: "ETH",
      bitcoin: "BTC",
      zcash: "ZEC",
      "usd-coin": "USDC",
    })) {
      const usd = json[coinId]?.usd;
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
        out[ticker] = usd;
      }
    }

    return NextResponse.json(out, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.warn("[api/prices] CoinGecko fetch failed; using fallback prices", error);
    return fallbackPrices();
  }
}

function fallbackPrices(): NextResponse {
  return NextResponse.json(FALLBACK_PRICES_USD, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
      "x-clearsig-price-source": "fallback",
    },
  });
}
