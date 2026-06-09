import {
  buildAgentMarketplaceRegistry,
  parseAgentMarketplaceWallets,
  type AgentMarketplaceRegistry,
} from "@/lib/agents/marketplaceRegistry";
import {
  agentServerStatePersistenceStatus,
  getAgentServerWalletState,
} from "@/lib/agents/serverState";

export interface AgentMarketplaceRegistryLoadResult {
  registry: AgentMarketplaceRegistry;
  wallets: string[];
  persistence: ReturnType<typeof agentServerStatePersistenceStatus>;
  source: "config" | "query" | "empty";
}

export async function loadAgentMarketplaceRegistry({
  queryWallets = [],
  now = Date.now(),
}: {
  queryWallets?: string[];
  now?: number;
} = {}): Promise<AgentMarketplaceRegistryLoadResult> {
  const configured = parseAgentMarketplaceWallets(
    process.env.CLEARSIG_AGENT_MARKETPLACE_WALLETS,
  );
  const queryAllowed = process.env.CLEARSIG_AGENT_MARKETPLACE_ALLOW_QUERY === "1";
  const query = queryAllowed ? normalizeWallets(queryWallets) : [];
  const wallets = configured.length > 0 ? configured : query;
  const states = await Promise.all(wallets.map((wallet) => getAgentServerWalletState(wallet)));
  return {
    registry: buildAgentMarketplaceRegistry({ states, now }),
    wallets,
    persistence: agentServerStatePersistenceStatus(),
    source: configured.length > 0 ? "config" : query.length > 0 ? "query" : "empty",
  };
}

export function marketplaceWalletsFromSearch(value: string | null): string[] {
  return parseAgentMarketplaceWallets(value ?? undefined);
}

function normalizeWallets(wallets: string[]): string[] {
  return parseAgentMarketplaceWallets(wallets.join(","));
}

