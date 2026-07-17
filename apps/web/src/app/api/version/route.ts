import { NextResponse } from "next/server";
import { getFrontendVersion } from "@/lib/release/version";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getFrontendVersion(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
