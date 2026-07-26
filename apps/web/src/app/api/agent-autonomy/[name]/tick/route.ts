import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  AgentServerStatePersistenceError,
  agentServerStatePersistenceStatus,
} from "@/features/agents/server/serverState";
import { runAgentAutonomyTick } from "@/lib/agents/serverAutonomousTrading";
import type { TradingVenue } from "@/lib/agents/types";

const MAX_BODY_BYTES = 4_000;

interface RouteContext {
  params: Promise<{
    name: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("agent-autonomy", clientIp(request), {
    capacity: 6,
    refillPerSec: 1 / 30,
  });
  if (limited) return limited;

  const raw = await readBoundedBody(request);
  if (!raw.ok) return raw.response;

  let body: unknown = {};
  if (raw.text.trim()) {
    try {
      body = JSON.parse(raw.text);
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }
  }

  const venue = venueField(body, "venue") ?? "hyperliquid_testnet";
  try {
    const result = await runAgentAutonomyTick({
      walletName: decodeRouteParam((await context.params).name),
      agentId: stringField(body, "agentId") || null,
      venue,
      maxMarkets: numberField(body, "maxMarkets", 40),
      maxIdeas: numberField(body, "maxIdeas", 3),
    });
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AgentServerStatePersistenceError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          persistence: agentServerStatePersistenceStatus(),
        },
        { status: 503 },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Agent autonomy tick failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function readBoundedBody(
  request: NextRequest,
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Autonomy tick body is too large." },
        { status: 413 },
      ),
    };
  }
  return { ok: true, text };
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stringField(input: unknown, key: string): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberField(input: unknown, key: string, fallback: number): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const value = (input as Record<string, unknown>)[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function venueField(input: unknown, key: string): TradingVenue | null {
  const value = stringField(input, key);
  return value === "hyperliquid_testnet" ||
    value === "mock_perps" ||
    value === "bulktrade_mock"
    ? value
    : null;
}
