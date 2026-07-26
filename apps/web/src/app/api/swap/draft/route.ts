import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  type SwapAssetId,
  type SwapQuote,
} from "@/lib/swap/drafts";
import { solverCreateDraft } from "@/lib/swap/solverService";

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("swap-draft", clientIp(request), {
    capacity: 20,
    refillPerSec: 1 / 3,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const input = normalizeDraftRequest(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const result = solverCreateDraft(input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    ok: true,
    draft: result.draft,
    collateral: result.collateral,
    next: result.draft.policyDecision.allowed ? "reserve" : "review_policy",
  });
}

function normalizeDraftRequest(body: unknown):
  | { ok: true; walletName: string; quote: SwapQuote }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const row = body as Record<string, unknown>;
  const walletName = typeof row.walletName === "string" ? row.walletName.trim() : "";
  const quote = row.quote;
  if (!walletName) return { ok: false, error: "walletName is required." };
  if (!quote || typeof quote !== "object") {
    return { ok: false, error: "quote is required." };
  }
  const q = quote as Partial<SwapQuote>;
  if (
    typeof q.id !== "string" ||
    typeof q.from !== "string" ||
    typeof q.to !== "string" ||
    typeof q.amount !== "string" ||
    typeof q.intentHash !== "string" ||
    typeof q.expiresAt !== "number"
  ) {
    return { ok: false, error: "quote is incomplete." };
  }
  return {
    ok: true,
    walletName,
    quote: {
      ...(q as SwapQuote),
      from: q.from as SwapAssetId,
      to: q.to as SwapAssetId,
    },
  };
}
