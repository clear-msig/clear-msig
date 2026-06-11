import type {
  AgentTradeProposal,
  TradingVenue,
} from "@/lib/agents/types";

export interface AgentAutonomyExecutionSummary {
  placed: boolean;
  message: string;
}

export interface AgentAutonomyPreparedProposal {
  proposal: AgentTradeProposal;
  duplicate: boolean;
  execution: AgentAutonomyExecutionSummary | null;
}

export interface AgentAutonomyTickClientResult {
  ok: boolean;
  message: string;
  venue?: TradingVenue;
  scannedMarkets?: number;
  consideredMarkets?: number;
  proposals?: AgentAutonomyPreparedProposal[];
}

export async function runAgentAutonomyTickClient({
  walletName,
  agentId,
  venue = "hyperliquid_testnet",
  maxMarkets = 40,
  maxIdeas = 3,
}: {
  walletName: string;
  agentId?: string | null;
  venue?: TradingVenue;
  maxMarkets?: number;
  maxIdeas?: number;
}): Promise<AgentAutonomyTickClientResult> {
  try {
    const response = await fetch(
      `/api/agent-autonomy/${encodeURIComponent(walletName)}/tick`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, venue, maxMarkets, maxIdeas }),
      },
    );
    const body = await safeJson(response);
    if (!response.ok || body.ok !== true) {
      return {
        ok: false,
        message:
          stringField(body, "error") ||
          stringField(body, "message") ||
          "Autonomy scan failed.",
      };
    }
    return {
      ok: true,
      message: stringField(body, "message") || "Autonomy scan complete.",
      venue: tradingVenueField(body, "venue"),
      scannedMarkets: numberField(body, "scannedMarkets"),
      consideredMarkets: numberField(body, "consideredMarkets"),
      proposals: proposalList(body.proposals),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Autonomy scan failed.",
    };
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = (await response.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function proposalList(value: unknown): AgentAutonomyPreparedProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const proposal = record.proposal;
      if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
        return null;
      }
      return {
        proposal: proposal as AgentTradeProposal,
        duplicate: record.duplicate === true,
        execution: executionSummary(record.execution),
      };
    })
    .filter((item): item is AgentAutonomyPreparedProposal => Boolean(item));
}

function executionSummary(value: unknown): AgentAutonomyExecutionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    placed: record.placed === true,
    message: stringField(record, "message") || "Execution handoff checked.",
  };
}

function tradingVenueField(
  input: Record<string, unknown>,
  field: string,
): TradingVenue | undefined {
  const value = stringField(input, field);
  return value === "mock_perps" ||
    value === "hyperliquid_testnet" ||
    value === "bulktrade_mock"
    ? value
    : undefined;
}

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  return typeof value === "string" ? value : "";
}

function numberField(
  input: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = input[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
