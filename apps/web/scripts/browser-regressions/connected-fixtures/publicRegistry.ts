import {
  buildAgentMarketplaceRegistry,
  parseAgentMarketplaceWallets,
} from "@/lib/agents/marketplaceRegistry";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import type { AgentServerWalletState } from "@/features/agents/server/stateTypes";
const state: AgentServerWalletState = {
  walletName: "operations",
  agents: [
    {
      id: "review-trader",
      walletName: "operations",
      name: "Review trader",
      kind: "manual",
      status: "paused",
      description:
        "Synthetic profile for app-owned layout review. No execution.",
      createdAt: 1791288000000,
      updatedAt: 1791288000000,
      version: 1,
      strategy: {
        mode: "read_only",
        summary: "Local fixture only",
        allowedMarkets: ["SOL-PERP"],
        entryRules: "Review before action",
        exitRules: "No live execution",
        riskRules: "Blocked",
        executionProtocol: "Synthetic review",
        killSwitchRules: "No execution",
        updatedAt: 1791288000000,
      },
      publishing: {
        status: "published",
        slug: "review-trader",
        publicSummary: "Synthetic local review profile; not a live trader.",
        moderation: {
          status: "approved",
          reason: "Synthetic fixture only",
          reviewedBy: "local-fixture",
          updatedAt: 1791288000000,
          version: 1,
        },
        visibleMetrics: [],
        updatedAt: 1791288000000,
        version: 1,
      },
    },
  ],
  policy: defaultAgentVaultPolicy("operations"),
  proposals: [],
  sessions: [],
  executions: [],
  events: [],
  approvals: [],
  scorecards: {},
  updatedAt: 1791288000000,
  version: 1,
};
export async function loadAgentPublicWalletState(_walletName: string) {
  return state;
}
export async function loadAgentMarketplaceRegistry(
  _options: { queryWallets?: string[]; now?: number } = {},
) {
  return {
    registry: buildAgentMarketplaceRegistry({ states: [state] }),
    wallets: ["operations"],
    persistence: { durable: false, backend: "local-fixture" },
    source: "empty" as const,
  };
}
export const marketplaceWalletsFromSearch = (value: string | null) =>
  parseAgentMarketplaceWallets(value ?? undefined);
