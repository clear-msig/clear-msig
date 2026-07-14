import { NextResponse, type NextRequest } from "next/server";
import { buildAgentPublicProfile } from "@/lib/agents/publicProfile";
import {
  AgentServerStatePersistenceError,
  agentServerStatePersistenceStatus,
  getAgentServerWalletState,
} from "@/features/agents/server/serverState";

interface RouteContext {
  params: Promise<{ name: string; slug: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { name, slug } = await context.params;
  try {
    const state = await getAgentServerWalletState(decodeRouteParam(name));
    const profile = buildAgentPublicProfile({
      state,
      slug: decodeRouteParam(slug),
    });
    if (!profile) {
      return NextResponse.json(
        { ok: false, error: "Public agent profile not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      profile,
      persistence: agentServerStatePersistenceStatus(),
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
    throw error;
  }
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

