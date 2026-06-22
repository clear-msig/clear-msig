import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  buildSwapExecutionReceipt,
  type SwapDraft,
} from "@/lib/swap/drafts";

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

  const receipt = buildSwapExecutionReceipt(draft.value);
  const ikaConfigured =
    process.env.CLEARSIG_SWAP_IKA_ENABLED === "1" &&
    !!process.env.CLEARSIG_SWAP_SOLVER_URL;

  if (!ikaConfigured) {
    return NextResponse.json(
      {
        ok: false,
        receipt,
        readiness: {
          state: "adapter_not_configured",
          message:
            "Swap execution is policy-checked, but the backend/Ika solver adapter is not configured on this deployment.",
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    receipt: {
      ...receipt,
      status: "ready_for_ika",
      title: "Ready for Ika signing",
      message:
        "The draft passed policy and can be handed to the configured Ika execution adapter.",
    },
    readiness: {
      state: "ready_for_ika",
      message: "Configured adapter can now prepare source-chain execution.",
    },
  });
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
