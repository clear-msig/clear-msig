import {
  createClearSigLibraryPracticeIdea,
  createClearSigLibraryTrader,
  CLEARSIG_TRADER_LIBRARY,
} from "@/lib/agents/traderLibrary";
import {
  closeMockAgentExecution,
  listAgentExecutions,
  listAgents,
  newAgentProposalId,
  newAgentSessionId,
  saveAgent,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  saveAgentSession,
} from "@/features/agents/local-state/store";
import type { AgentProfile, AgentTradeProposal } from "@/lib/agents/types";

const DEMO_AGENT_PREFIX = "clearsig-demo-agent:";
const DEMO_SIGNAL_PREFIX = "clearsig-demo-signal:";

const DEMO_PNL_BY_TRADER: Record<string, string[]> = {
  "steady-btc": ["18", "9", "-6"],
  "balanced-markets": ["26", "-10", "14", "7"],
  "treasury-guard": ["8", "4", "-3"],
};

export interface AgentDemoHistoryResult {
  agentsCreated: number;
  tradesCreated: number;
  stoppedIdeasCreated: number;
}

export function seedClearSigAgentDemoHistory({
  walletName,
  now = Date.now(),
}: {
  walletName: string;
  now?: number;
}): AgentDemoHistoryResult {
  let agentsCreated = 0;
  let tradesCreated = 0;
  let stoppedIdeasCreated = 0;
  const agents = listAgents(walletName);
  const executions = listAgentExecutions(walletName);

  for (const template of CLEARSIG_TRADER_LIBRARY) {
    const agentId = `${DEMO_AGENT_PREFIX}${template.id}`;
    const existing = agents.find((agent) => agent.id === agentId);
    const agent =
      existing ??
      createClearSigLibraryTrader({
        template,
        walletName,
        id: agentId,
        now,
      });
    const demoAgent: AgentProfile = {
      ...agent,
      name: `${template.name} Demo`,
      description: `${template.description} Demo practice history is shown for user testing.`,
      status: "active",
      updatedAt: now,
    };
    saveAgent(demoAgent);
    if (!existing) agentsCreated += 1;

    const hasDemoTrades = executions.some(
      (execution) =>
        execution.agentId === demoAgent.id &&
        execution.proposalId.startsWith(`${DEMO_SIGNAL_PREFIX}${template.id}:`),
    );
    if (hasDemoTrades) continue;

    saveAgentSession({
      id: `${DEMO_SIGNAL_PREFIX}${template.id}:allowance`,
      walletName,
      agentId: demoAgent.id,
      status: "active",
      startsAt: now,
      expiresAt: now + 4 * 60 * 60 * 1000,
      allowedVenues: ["mock_perps"],
      allowedMarkets: [...template.markets],
      maxNotionalUsd: template.defaultNotionalUsd,
      maxLeverage: template.defaultLeverage,
      maxOpenPositions: 1,
      allocationTierId: "probation",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    for (const [index, pnlUsd] of (DEMO_PNL_BY_TRADER[template.id] ?? []).entries()) {
      const proposal = createClearSigLibraryPracticeIdea({
        agent: demoAgent,
        maxNotionalUsd: template.defaultNotionalUsd,
        id: `${DEMO_SIGNAL_PREFIX}${template.id}:${index}`,
        now: now + index,
      });
      if (!proposal) continue;
      const saved = saveAgentProposalAndExecuteIfAllowed({
        ...proposal,
        clientSignalId: `${DEMO_SIGNAL_PREFIX}${template.id}:${index}`,
        status: "approved",
      });
      if (saved.execution) {
        closeMockAgentExecution(walletName, saved.execution.id, pnlUsd);
        tradesCreated += 1;
      }
    }

    const stopped = stoppedIdea({
      agent: demoAgent,
      templateId: template.id,
      now,
    });
    saveAgentProposal(stopped);
    stoppedIdeasCreated += 1;
  }

  return {
    agentsCreated,
    tradesCreated,
    stoppedIdeasCreated,
  };
}

function stoppedIdea({
  agent,
  templateId,
  now,
}: {
  agent: AgentProfile;
  templateId: string;
  now: number;
}): AgentTradeProposal {
  const market = agent.strategy?.allowedMarkets[0] ?? "BTC-PERP";
  return {
    id: `${DEMO_SIGNAL_PREFIX}${templateId}:stopped`,
    walletName: agent.walletName,
    agentId: agent.id,
    venue: "mock_perps",
    market,
    side: "long",
    orderType: "market",
    notionalUsd: "999999",
    leverage: 10,
    entryPrice: "1",
    stopLossPrice: null,
    takeProfitPrice: null,
    thesis: "Demo stopped idea: this intentionally exceeds the allowance.",
    confidence: 50,
    clientSignalId: `${DEMO_SIGNAL_PREFIX}${templateId}:stopped`,
    expiresAt: now + 15 * 60 * 1000,
    evaluationDecision: "blocked",
    policyViolations: [
      {
        code: "notional_too_large",
        message: "Demo safety stop: trade size is above the current allowance.",
        severity: "block",
      },
    ],
    status: "blocked",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
