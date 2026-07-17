import type {
  AgentTradeProposal,
  TradeOrderType,
  TradeSide,
  TradingVenue,
} from "@/lib/agents/types";
import { executionAdapterLabel } from "@/lib/agents/executionAdapters";
import { readHyperliquidTestnetExecutorConfig } from "@/lib/agents/hyperliquidTestnetConfig";

export type AgentServerExecutionState =
  | "local_only"
  | "not_configured"
  | "ready"
  | "unsupported";

export interface AgentServerExecutionReadiness {
  venue: TradingVenue;
  label: string;
  state: AgentServerExecutionState;
  canSubmit: boolean;
  missingEnvVars: string[];
  configurationErrors?: string[];
  message: string;
}

export interface AgentServerExecutionRequest {
  walletName: string;
  agentId: string;
  proposalId: string;
  venue: TradingVenue;
  market: string;
  side: TradeSide;
  orderType: TradeOrderType;
  notionalUsd: string;
  leverage: number;
  approvedAt: number;
}

export interface AgentServerExecutionValidation {
  request: AgentServerExecutionRequest | null;
  errors: string[];
}

const SERVER_ENV_BY_VENUE: Partial<Record<TradingVenue, string[]>> = {
  hyperliquid_testnet: [
    "CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS",
    "CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS",
    "CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL",
    "CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN",
  ],
};

const LOCAL_ONLY_VENUES: TradingVenue[] = ["mock_perps", "bulktrade_mock"];

export function serverAgentExecutionReadiness(
  venue: TradingVenue,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgentServerExecutionReadiness {
  if (LOCAL_ONLY_VENUES.includes(venue)) {
    return {
      venue,
      label: executionAdapterLabel(venue),
      state: "local_only",
      canSubmit: false,
      missingEnvVars: [],
      message: "This venue opens paper trades in the browser.",
    };
  }

  const required = SERVER_ENV_BY_VENUE[venue];
  if (!required) {
    return {
      venue,
      label: executionAdapterLabel(venue),
      state: "unsupported",
      canSubmit: false,
      missingEnvVars: [],
      message: "This venue does not have a server trading adapter yet.",
    };
  }

  const missingEnvVars = required.filter((key) => !env[key]?.trim());
  if (missingEnvVars.length > 0) {
    return {
      venue,
      label: executionAdapterLabel(venue),
      state: "not_configured",
      canSubmit: false,
      missingEnvVars,
      message: "Server trading is not configured for this venue yet.",
    };
  }
  if (venue === "hyperliquid_testnet") {
    const parsed = readHyperliquidTestnetExecutorConfig(env);
    if (!parsed.config) {
      return {
        venue,
        label: executionAdapterLabel(venue),
        state: "not_configured",
        canSubmit: false,
        missingEnvVars: [],
        configurationErrors: parsed.errors,
        message: "Server trading configuration is invalid for Hyperliquid testnet.",
      };
    }
  }

  return {
    venue,
    label: executionAdapterLabel(venue),
    state: "ready",
    canSubmit: true,
    missingEnvVars: [],
    message: "Backend-only Hyperliquid testnet executor is configured.",
  };
}

export function normalizeServerExecutionRequest(
  input: unknown,
): AgentServerExecutionValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { request: null, errors: ["Request body must be an object."] };
  }

  const record = input as Record<string, unknown>;
  const walletName = stringField(record, "walletName");
  const agentId = stringField(record, "agentId");
  const proposalId = stringField(record, "proposalId");
  const venue = venueField(record, "venue");
  const market = stringField(record, "market").toUpperCase();
  const side = sideField(record, "side");
  const orderType = orderTypeField(record, "orderType");
  const notionalUsd = stringField(record, "notionalUsd");
  const leverage = numberField(record, "leverage");
  const approvedAt = numberField(record, "approvedAt");

  if (!walletName) errors.push("walletName is required.");
  if (!agentId) errors.push("agentId is required.");
  if (!proposalId) errors.push("proposalId is required.");
  if (!venue) errors.push("venue is required.");
  if (!market) errors.push("market is required.");
  if (!side) errors.push("side must be long or short.");
  if (!orderType) errors.push("orderType must be market or limit.");
  if (!positiveDecimalString(notionalUsd)) {
    errors.push("notionalUsd must be a positive number.");
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    errors.push("leverage must be greater than zero.");
  }
  if (!Number.isFinite(approvedAt) || approvedAt <= 0) {
    errors.push("approvedAt is required.");
  }

  if (errors.length > 0 || !venue || !side || !orderType) {
    return { request: null, errors };
  }

  return {
    request: {
      walletName,
      agentId,
      proposalId,
      venue,
      market,
      side,
      orderType,
      notionalUsd,
      leverage,
      approvedAt,
    },
    errors: [],
  };
}

export function serverExecutionRequestFromProposal(
  proposal: AgentTradeProposal,
  approvedAt = Date.now(),
): AgentServerExecutionRequest {
  return {
    walletName: proposal.walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    venue: proposal.venue,
    market: proposal.market,
    side: proposal.side,
    orderType: proposal.orderType,
    notionalUsd: proposal.notionalUsd,
    leverage: proposal.leverage,
    approvedAt,
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function venueField(
  record: Record<string, unknown>,
  key: string,
): TradingVenue | null {
  const value = stringField(record, key);
  return isTradingVenue(value) ? value : null;
}

function sideField(record: Record<string, unknown>, key: string): TradeSide | null {
  const value = stringField(record, key);
  return value === "long" || value === "short" ? value : null;
}

function orderTypeField(
  record: Record<string, unknown>,
  key: string,
): TradeOrderType | null {
  const value = stringField(record, key);
  return value === "market" || value === "limit" ? value : null;
}

function isTradingVenue(value: string): value is TradingVenue {
  return (
    value === "mock_perps" ||
    value === "bulktrade_mock" ||
    value === "hyperliquid_testnet"
  );
}

function positiveDecimalString(value: string): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}
