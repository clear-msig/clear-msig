import {
  buildAgentMarketplaceRegistry,
  parseAgentMarketplaceWallets,
  type AgentMarketplaceRegistry,
} from "@/lib/agents/marketplaceRegistry";
import {
  agentServerStatePersistenceStatus,
  getAgentServerWalletState,
} from "@/features/agents/server/serverState";
import { withAgentWalletStorageScope } from "@/features/agents/server/walletScope";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { getConnection } from "@/lib/chain/client";
import { getAgentChainGenesisHash } from "@/lib/auth/walletAuthorization";

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
  const states = await Promise.all(wallets.map(async (walletName) => {
    const state = await loadAgentPublicWalletState(walletName);
    if (!state) throw new Error("Published agent wallet could not be resolved canonically.");
    return state;
  }));
  return {
    registry: buildAgentMarketplaceRegistry({ states, now }),
    wallets,
    persistence: agentServerStatePersistenceStatus(),
    source: configured.length > 0 ? "config" : query.length > 0 ? "query" : "empty",
  };
}

export async function loadAgentPublicWalletState(walletName: string) {
  const wallet = await fetchWalletByName(getConnection(), walletName);
  if (!wallet) return null;
  const chainGenesisHash = await getAgentChainGenesisHash();
  return withAgentWalletStorageScope({ walletName, walletAddress: wallet.pda.toBase58(), chainGenesisHash },
    () => getAgentServerWalletState(walletName));
}

export function marketplaceWalletsFromSearch(value: string | null): string[] {
  return parseAgentMarketplaceWallets(value ?? undefined);
}

function normalizeWallets(wallets: string[]): string[] {
  return parseAgentMarketplaceWallets(wallets.join(","));
}
