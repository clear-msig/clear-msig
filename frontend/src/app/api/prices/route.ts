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
      return NextResponse.json(
        { error: `CoinGecko HTTP ${resp.status}`, detail: detail.slice(0, 200) },
        { status: 502 },
      );
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
    console.error("[api/prices] CoinGecko fetch failed", error);
    return NextResponse.json(
      { error: "Unable to load live prices." },
      { status: 502 },
    );
  }
}
