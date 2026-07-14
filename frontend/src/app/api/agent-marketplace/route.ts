import { NextResponse, type NextRequest } from "next/server";
import {
  loadAgentMarketplaceRegistry,
  marketplaceWalletsFromSearch,
} from "@/lib/agents/serverMarketplaceRegistry";
import {
  AgentServerStatePersistenceError,
  agentServerStatePersistenceStatus,
} from "@/features/agents/server/serverState";

export async function GET(request: NextRequest) {
  try {
    const result = await loadAgentMarketplaceRegistry({
      queryWallets: marketplaceWalletsFromSearch(
        request.nextUrl.searchParams.get("wallets"),
      ),
    });
    return NextResponse.json({
      ok: true,
      registry: result.registry,
      source: result.source,
      walletCount: result.wallets.length,
      persistence: result.persistence,
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

