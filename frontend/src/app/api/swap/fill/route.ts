import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { solverFill } from "@/lib/swap/solverService";

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("swap-fill", clientIp(request), {
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

  const reservationId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).reservationId
      : null;
  if (typeof reservationId !== "string" || !reservationId.trim()) {
    return NextResponse.json(
      { error: "reservationId is required." },
      { status: 400 },
    );
  }

  const result = solverFill({ reservationId: reservationId.trim() });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, fill: result.fill });
}
