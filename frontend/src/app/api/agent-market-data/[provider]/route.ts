import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  fetchAgentMarketData,
  isAgentMarketDataProviderId,
  serverAgentMarketDataReadiness,
} from "@/lib/agents/serverMarketDataAdapters";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const limited = await checkRateLimit("agent-market-data", clientIp(request), {
    capacity: 60,
    refillPerSec: 1,
  });
  if (limited) return limited;

  const { provider: rawProvider } = await context.params;
  const provider = decodeRouteParam(rawProvider).trim().toLowerCase();
  if (!isAgentMarketDataProviderId(provider)) {
    return NextResponse.json(
      { error: "Unsupported market-data provider." },
      { status: 404 },
    );
  }

  const readiness = serverAgentMarketDataReadiness(provider);
  if (readiness.state !== "ready") {
    return NextResponse.json(
      { error: readiness.message, readiness },
      { status: 501 },
    );
  }

  const market = request.nextUrl.searchParams.get("market") ?? "";
  try {
    const snapshot = await fetchAgentMarketData({ provider, market });
    return NextResponse.json(
      { ok: true, readiness, snapshot },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Market data failed." },
      { status: 400 },
    );
  }
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
