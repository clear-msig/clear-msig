import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/guard";
import { solverStatus } from "@/lib/swap/solverService";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request, { allowMissingOrigin: true });
  if (blocked) return blocked;

  const id = decodeURIComponent((await context.params).id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const result = solverStatus(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    fill: result.fill,
    reservation: result.reservation,
  });
}
