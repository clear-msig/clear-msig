import type {
  AgentProfile,
  AgentStrategyProfile,
  AgentTradeProposal,
  TradeSide,
  TradingVenue,
} from "@/lib/agents/types";
import type { AgentMarketDataSnapshot } from "@/lib/agents/marketData";

export type ClearSigTraderRisk = "cautious" | "balanced" | "active";

export interface ClearSigTraderTemplate {
  id: string;
  name: string;
  category: string;
  risk: ClearSigTraderRisk;
  summary: string;
  description: string;
  bestFor: string;
  markets: string[];
  defaultMarket: string;
  defaultSide: TradeSide;
  defaultNotionalUsd: string;
  defaultLeverage: number;
  stopDistancePct: number;
  takeProfitDistancePct: number;
  referencePriceUsd: string;
  strategy: Omit<AgentStrategyProfile, "updatedAt">;
}

export const CLEARSIG_TRADER_LIBRARY: readonly ClearSigTraderTemplate[] = [
  {
    id: "steady-btc",
    name: "Steady BTC",
    category: "Focused",
    risk: "cautious",
    summary: "A patient Bitcoin-only practice trader.",
    description:
      "Waits for a clear move, uses no added borrowing, and leaves room between trades.",
    bestFor: "A calm first experience with one familiar market.",
    markets: ["BTC-PERP"],
    defaultMarket: "BTC-PERP",
    defaultSide: "long",
    defaultNotionalUsd: "100",
    defaultLeverage: 1,
    stopDistancePct: 3,
    takeProfitDistancePct: 5,
    referencePriceUsd: "67500",
    strategy: {
      mode: "paper",
      summary: "Patient Bitcoin trend practice with small, infrequent trades.",
      allowedMarkets: ["BTC-PERP"],
      entryRules:
        "Enter only when Bitcoin shows a clear move and the current allowance has room.",
      exitRules:
        "Every idea includes a stop loss and a profit target. Exit when either is reached or the reason for the trade no longer holds.",
      riskRules:
        "Use no added borrowing, keep one trade open at a time, and stay below every ClearSig safety limit.",
      executionProtocol:
        "Send one small practice idea at a time and let ClearSig check it before opening the trade.",
      killSwitchRules:
        "Stop immediately when ClearSig pauses trading, the allowance ends, a safety rule fails, or the daily loss limit is reached.",
    },
  },
  {
    id: "balanced-markets",
    name: "Balanced Markets",
    category: "Diversified",
    risk: "balanced",
    summary: "A measured practice trader across Bitcoin, Ether, and Solana.",
    description:
      "Looks across three major markets, chooses one idea at a time, and keeps risk modest.",
    bestFor: "Users who want broader market coverage without aggressive trading.",
    markets: ["BTC-PERP", "ETH-PERP", "SOL-PERP"],
    defaultMarket: "ETH-PERP",
    defaultSide: "long",
    defaultNotionalUsd: "200",
    defaultLeverage: 1,
    stopDistancePct: 2.5,
    takeProfitDistancePct: 4,
    referencePriceUsd: "3850",
    strategy: {
      mode: "paper",
      summary: "Measured practice ideas across BTC, ETH, and SOL.",
      allowedMarkets: ["BTC-PERP", "ETH-PERP", "SOL-PERP"],
      entryRules:
        "Compare the allowed markets and choose only one clear opportunity with enough room inside the current allowance.",
      exitRules:
        "Set a stop loss and profit target before entry. Exit when the setup weakens or either level is reached.",
      riskRules:
        "Keep trade sizes modest, avoid stacking similar trades, and follow ClearSig's open-trade and daily loss limits.",
      executionProtocol:
        "Send one selected practice idea to ClearSig and wait for its safety check before acting.",
      killSwitchRules:
        "Stop when ClearSig pauses trading, the allowance expires, market information is unavailable, or a safety rule fails.",
    },
  },
  {
    id: "treasury-guard",
    name: "Treasury Guard",
    category: "Protective",
    risk: "cautious",
    summary: "A defensive practice trader designed to offset falling markets.",
    description:
      "Practices small defensive Bitcoin trades and prioritizes limiting losses over chasing returns.",
    bestFor: "Learning how a treasury could reduce risk during market weakness.",
    markets: ["BTC-PERP"],
    defaultMarket: "BTC-PERP",
    defaultSide: "short",
    defaultNotionalUsd: "100",
    defaultLeverage: 1,
    stopDistancePct: 2,
    takeProfitDistancePct: 3.5,
    referencePriceUsd: "67500",
    strategy: {
      mode: "paper",
      summary: "Small defensive Bitcoin practice trades for treasury protection.",
      allowedMarkets: ["BTC-PERP"],
      entryRules:
        "Suggest a defensive trade only when the treasury wants protection and the current allowance has room.",
      exitRules:
        "Use a close stop loss, take profit early, and exit when protection is no longer needed.",
      riskRules:
        "Use no added borrowing, keep the trade small, and prioritize loss control over return.",
      executionProtocol:
        "Send one defensive practice idea to ClearSig and wait for its safety check.",
      killSwitchRules:
        "Stop immediately when ClearSig pauses trading, the allowance ends, or the trade would exceed a safety limit.",
    },
  },
] as const;

export function clearSigTraderById(
  id: string | null | undefined,
): ClearSigTraderTemplate | null {
  return CLEARSIG_TRADER_LIBRARY.find((trader) => trader.id === id) ?? null;
}

export function createClearSigLibraryTrader({
  template,
  walletName,
  id,
  now = Date.now(),
}: {
  template: ClearSigTraderTemplate;
  walletName: string;
  id: string;
  now?: number;
}): AgentProfile {
  return {
    id,
    walletName,
    name: template.name,
    kind: "mock",
    status: "active",
    libraryTraderId: template.id,
    description: template.description,
    strategy: {
      ...template.strategy,
      allowedMarkets: [...template.strategy.allowedMarkets],
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function createClearSigLibraryPracticeIdea({
  agent,
  venue = "mock_perps",
  maxNotionalUsd,
  maxLeverage,
  marketData,
  now = Date.now(),
  id,
}: {
  agent: AgentProfile;
  venue?: TradingVenue;
  maxNotionalUsd?: string | null;
  maxLeverage?: number | null;
  marketData?: AgentMarketDataSnapshot | null;
  now?: number;
  id: string;
}): AgentTradeProposal | null {
  if (
    agent.kind !== "mock" ||
    (venue !== "mock_perps" && venue !== "hyperliquid_testnet")
  ) {
    return null;
  }
  const template =
    clearSigTraderById(agent.libraryTraderId) ?? customPracticeTemplate(agent);
  const market = normalizeTemplateMarket(
    marketData?.market && template.markets.includes(marketData.market)
      ? marketData.market
      : template.defaultMarket,
  );
  const notional = Math.max(
    1,
    Math.min(
      positiveNumber(template.defaultNotionalUsd, 1),
      positiveNumber(maxNotionalUsd, positiveNumber(template.defaultNotionalUsd, 1)),
    ),
  );
  const mark = positiveNumber(marketData?.markPriceUsd, positiveNumber(template.referencePriceUsd, 1));
  const side = choosePracticeSide(template, agent, marketData);
  const leverage = positiveNumber(maxLeverage, template.defaultLeverage);
  const isLong = side === "long";
  const stopMultiplier = isLong
    ? 1 - template.stopDistancePct / 100
    : 1 + template.stopDistancePct / 100;
  const targetMultiplier = isLong
    ? 1 + template.takeProfitDistancePct / 100
    : 1 - template.takeProfitDistancePct / 100;

  return {
    id,
    walletName: agent.walletName,
    agentId: agent.id,
    venue,
    market,
    side,
    orderType: "market",
    notionalUsd: formatMoney(notional),
    leverage,
    entryPrice: formatPrice(mark),
    stopLossPrice: formatPrice(mark * stopMultiplier),
    takeProfitPrice: formatPrice(mark * targetMultiplier),
    thesis: marketData
      ? `${template.name} used ${marketData.source === "live" ? "live" : "practice"} ${marketData.market} market data at $${marketData.markPriceUsd} to prepare this ${side} ${template.category.toLowerCase()} practice idea with ${leverage}x max borrowing.`
      : `${template.name} prepared this ${side} practice idea with ${leverage}x max borrowing to demonstrate its ${template.category.toLowerCase()} approach.`,
    confidence: template.risk === "active" ? 68 : template.risk === "balanced" ? 66 : 64,
    clientSignalId: `clearsig-library:${agent.id}:${now}`,
    expiresAt: now + 15 * 60 * 1000,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function choosePracticeSide(
  template: ClearSigTraderTemplate,
  agent: AgentProfile,
  marketData?: AgentMarketDataSnapshot | null,
): TradeSide {
  const strategyText = [
    agent.strategy?.summary,
    agent.strategy?.entryRules,
    agent.strategy?.riskRules,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (strategyText.includes("short") || strategyText.includes("hedge")) {
    return "short";
  }
  if (strategyText.includes("long") || strategyText.includes("trend")) {
    return "long";
  }
  const funding = Number(marketData?.fundingRatePct ?? "");
  if (Number.isFinite(funding)) {
    if (funding > 0.025) return "short";
    if (funding < -0.01) return "long";
  }
  return template.defaultSide;
}

function customPracticeTemplate(agent: AgentProfile): ClearSigTraderTemplate {
  const market = agent.strategy?.allowedMarkets[0] ?? "BTC-PERP";
  const referencePriceUsd =
    market === "ETH-PERP" ? "3850" : market === "SOL-PERP" ? "172" : "67500";
  return {
    id: "custom-practice",
    name: agent.name,
    category: "Custom",
    risk: "cautious",
    summary: agent.strategy?.summary ?? "A custom ClearSig practice trader.",
    description: agent.description ?? "A custom ClearSig practice trader.",
    bestFor: "Trying your own trading plan.",
    markets: agent.strategy?.allowedMarkets ?? [market],
    defaultMarket: market,
    defaultSide: "long",
    defaultNotionalUsd: "100",
    defaultLeverage: 1,
    stopDistancePct: 3,
    takeProfitDistancePct: 5,
    referencePriceUsd,
    strategy: {
      mode: "paper",
      summary: agent.strategy?.summary,
      allowedMarkets: agent.strategy?.allowedMarkets ?? [market],
      entryRules: agent.strategy?.entryRules ?? "",
      exitRules: agent.strategy?.exitRules ?? "",
      riskRules: agent.strategy?.riskRules ?? "",
      executionProtocol: agent.strategy?.executionProtocol ?? "",
      killSwitchRules: agent.strategy?.killSwitchRules ?? "",
    },
  };
}

function normalizeTemplateMarket(value: string): string {
  return value.trim().toUpperCase();
}

function positiveNumber(value: string | number | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatMoney(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatPrice(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}
