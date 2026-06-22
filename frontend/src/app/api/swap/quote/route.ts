import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  buildSwapQuote,
  swapAsset,
  type SwapAssetId,
} from "@/lib/swap/drafts";

const ASSETS = new Set<SwapAssetId>(["SOL", "ETH", "BTC", "ZEC", "HYPE"]);

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("swap-quote", clientIp(request), {
    capacity: 30,
    refillPerSec: 1,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const input = normalizeQuoteRequest(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const quote = buildSwapQuote(input.value);
  if (!quote) {
    return NextResponse.json(
      { error: "Enter a valid amount and choose two different assets." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    quote,
    assets: {
      from: swapAsset(quote.from),
      to: swapAsset(quote.to),
    },
  });
}

function normalizeQuoteRequest(body: unknown):
  | {
      ok: true;
      value: { from: SwapAssetId; to: SwapAssetId; amount: string };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const row = body as Record<string, unknown>;
  const from = typeof row.from === "string" ? row.from.toUpperCase() : "";
  const to = typeof row.to === "string" ? row.to.toUpperCase() : "";
  const amount = typeof row.amount === "string" ? row.amount.trim() : "";
  if (!ASSETS.has(from as SwapAssetId) || !ASSETS.has(to as SwapAssetId)) {
    return { ok: false, error: "Unsupported swap asset." };
  }
  if (!amount) {
    return { ok: false, error: "Amount is required." };
  }
  return {
    ok: true,
    value: { from: from as SwapAssetId, to: to as SwapAssetId, amount },
  };
}
