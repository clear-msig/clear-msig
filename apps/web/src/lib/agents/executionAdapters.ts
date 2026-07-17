import type {
  AgentExecutionAdapterStatus,
  AgentExecutionMode,
  TradingVenue,
} from "@/lib/agents/types";

export interface AgentExecutionAdapterInfo {
  venue: TradingVenue;
  label: string;
  mode: AgentExecutionMode;
  status: AgentExecutionAdapterStatus;
  canOpenLocally: boolean;
  unavailableReason?: string;
}

const ADAPTERS: Record<TradingVenue, AgentExecutionAdapterInfo> = {
  mock_perps: {
    venue: "mock_perps",
    label: "Paper Perps",
    mode: "paper",
    status: "ready",
    canOpenLocally: true,
  },
  bulktrade_mock: {
    venue: "bulktrade_mock",
    label: "Bulk Paper",
    mode: "paper",
    status: "ready",
    canOpenLocally: true,
  },
  hyperliquid_testnet: {
    venue: "hyperliquid_testnet",
    label: "Hyperliquid Testnet",
    mode: "testnet",
    status: "backend_required",
    canOpenLocally: false,
    unavailableReason:
      "Hyperliquid testnet execution must run through the backend adapter.",
  },
};

export function agentExecutionAdapter(
  venue: TradingVenue,
): AgentExecutionAdapterInfo {
  return ADAPTERS[venue];
}

export function canOpenLocalAgentExecution(venue: TradingVenue): boolean {
  return agentExecutionAdapter(venue).canOpenLocally;
}

export function executionModeForVenue(venue: TradingVenue): AgentExecutionMode {
  return agentExecutionAdapter(venue).mode;
}

export function executionAdapterLabel(venue: TradingVenue): string {
  return agentExecutionAdapter(venue).label;
}

export function executionUnavailableReason(venue: TradingVenue): string | null {
  return agentExecutionAdapter(venue).unavailableReason ?? null;
}
