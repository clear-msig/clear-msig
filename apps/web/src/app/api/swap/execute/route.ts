import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { type SwapDraft } from "@/lib/swap/drafts";
import { solverFill, solverReserve } from "@/lib/swap/solverService";

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("swap-execute", clientIp(request), {
    capacity: 12,
    refillPerSec: 1 / 5,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const draft = normalizeExecutionRequest(body);
  if (!draft.ok) {
    return NextResponse.json({ error: draft.error }, { status: 400 });
  }

  const reserved = solverReserve({ draft: draft.value });
  if (!reserved.ok) {
    return NextResponse.json({ error: reserved.error }, { status: 409 });
  }

  const filled = solverFill({ reservationId: reserved.reservation.id });
  if (!filled.ok) {
    return NextResponse.json({ error: filled.error }, { status: 409 });
  }
  const adapterReady = filled.fill.status !== "adapter_not_configured";

  return NextResponse.json({
    ok: adapterReady,
    reservation: reserved.reservation,
    fill: filled.fill,
    receipt: filled.fill.receipt,
    readiness: {
      state: adapterReady ? "ready_for_ika" : "adapter_not_configured",
      message: filled.fill.message,
    },
  }, { status: adapterReady ? 200 : 409 });
}

function normalizeExecutionRequest(body: unknown):
  | { ok: true; value: SwapDraft }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const draft = (body as Record<string, unknown>).draft;
  if (!draft || typeof draft !== "object") {
    return { ok: false, error: "draft is required." };
  }
  const row = draft as Partial<SwapDraft>;
  if (
    typeof row.id !== "string" ||
    typeof row.walletName !== "string" ||
    typeof row.nonce !== "string" ||
    !row.quote ||
    !row.policyDecision
  ) {
    return { ok: false, error: "draft is incomplete." };
  }
  return { ok: true, value: row as SwapDraft };
}
