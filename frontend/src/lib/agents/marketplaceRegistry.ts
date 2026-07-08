import {
  buildAgentPublicProfile,
  isPubliclyVisible,
  publicProfileUrl,
  type AgentPublicProfile,
  type AgentPublicProfileLane,
} from "@/lib/agents/publicProfile";
import type {
  AgentCreatorRegistryReadiness,
  AgentCreatorType,
} from "@/lib/agents/creatorRegistry";
import type { AgentServerWalletState } from "@/lib/agents/serverState";
import type { AgentTrackRecordSource, TradingVenue } from "@/lib/agents/types";

export interface AgentMarketplaceEntry {
  walletName: string;
  agentId: string;
  name: string;
  slug: string;
  url: string;
  summary: string;
  creatorType: AgentCreatorType;
  creatorLabel: string;
  identityVerified: boolean;
  registryReadiness: AgentCreatorRegistryReadiness;
  primarySource: AgentTrackRecordSource;
  primaryScore: number | null;
  realizedPnlUsd: string | null;
  closedTrades: number | null;
  openTrades: number | null;
  winRatePct: number | null;
  ruleViolations: number | null;
  markets: string[];
  venues: TradingVenue[];
  laneSummaries: AgentPublicProfileLane[];
  publishedAt?: number;
  reviewedAt?: number;
  updatedAt: number;
}

export interface AgentMarketplaceRegistry {
  entries: AgentMarketplaceEntry[];
  filters: {
    markets: string[];
    venues: TradingVenue[];
    sources: AgentTrackRecordSource[];
  };
  walletCount: number;
  generatedAt: number;
  message: string;
}

export function buildAgentMarketplaceRegistry({
  states,
  now = Date.now(),
}: {
  states: AgentServerWalletState[];
  now?: number;
}): AgentMarketplaceRegistry {
  const entries = states
    .flatMap((state) =>
      state.agents
        .filter(isPubliclyVisible)
        .map((agent) =>
          buildAgentPublicProfile({
            state,
            slug: agent.publishing?.slug ?? agent.id,
            now,
          }),
        )
        .filter((profile): profile is AgentPublicProfile => Boolean(profile)),
    )
    .map((profile) => marketplaceEntry(profile))
    .sort(sortMarketplaceEntries);

  return {
    entries,
    filters: {
      markets: unique(entries.flatMap((entry) => entry.markets)),
      venues: unique(entries.flatMap((entry) => entry.venues)),
      sources: unique(entries.map((entry) => entry.primarySource)),
    },
    walletCount: states.length,
    generatedAt: now,
    message:
      entries.length > 0
        ? `${entries.length} approved creator agent${entries.length === 1 ? "" : "s"} available.`
        : "No approved creator agents are available yet.",
  };
}

export function parseAgentMarketplaceWallets(value: string | undefined): string[] {
  if (!value) return [];
  return unique(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function marketplaceEntry(profile: AgentPublicProfile): AgentMarketplaceEntry {
  const primary =
    profile.lanes.find((lane) => lane.source === profile.primarySource) ??
    profile.lanes[0];
  return {
    walletName: profile.walletName,
    agentId: profile.agentId,
    name: profile.name,
    slug: profile.slug,
    url: publicProfileUrl(profile.walletName, profile.slug),
    summary: profile.summary,
    creatorType: profile.creatorType,
    creatorLabel: profile.creatorLabel,
    identityVerified: Boolean(profile.identityPubkey),
    registryReadiness: profile.registryReadiness,
    primarySource: profile.primarySource,
    primaryScore: primary?.score ?? null,
    realizedPnlUsd: primary?.realizedPnlUsd ?? null,
    closedTrades: primary?.closedTrades ?? null,
    openTrades: primary?.openTrades ?? null,
    winRatePct: primary?.winRatePct ?? null,
    ruleViolations: primary?.ruleViolations ?? null,
    markets: profile.allowedMarkets,
    venues: profile.supportedVenues,
    laneSummaries: profile.lanes,
    publishedAt: profile.publishedAt,
    reviewedAt: profile.reviewedAt,
    updatedAt: profile.updatedAt,
  };
}

function sortMarketplaceEntries(a: AgentMarketplaceEntry, b: AgentMarketplaceEntry): number {
  return (
    sourceWeight(b.primarySource) - sourceWeight(a.primarySource) ||
    numberValue(b.primaryScore) - numberValue(a.primaryScore) ||
    numberValue(b.closedTrades) - numberValue(a.closedTrades) ||
    numberValue(b.realizedPnlUsd) - numberValue(a.realizedPnlUsd) ||
    b.updatedAt - a.updatedAt ||
    a.name.localeCompare(b.name)
  );
}

function sourceWeight(source: AgentTrackRecordSource): number {
  switch (source) {
    case "verified_live":
      return 3;
    case "testnet":
      return 2;
    case "paper":
      return 1;
  }
}

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort();
}
