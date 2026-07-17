import { NextResponse } from "next/server";
import { readSwapOperatorStatus } from "@/lib/swap/operatorConfig";

export async function GET() {
  return NextResponse.json({
    ok: true,
    operator: readSwapOperatorStatus(),
  });
}
