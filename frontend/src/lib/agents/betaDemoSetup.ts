import {
  createClearSigLibraryPracticeIdea,
  createClearSigLibraryTrader,
  clearSigTraderById,
} from "@/lib/agents/traderLibrary";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  findAgent,
  listAgentExecutions,
  newAgentProposalId,
  saveAgent,
  saveAgentProposalAndExecuteIfAllowed,
  saveAgentSession,
  saveAgentVaultPolicy,
} from "@/lib/agents/storage";
import { seedClearSigAgentDemoHistory } from "@/lib/agents/demoHistory";
import type { AgentProfile, AgentSessionGrant } from "@/lib/agents/types";

const BETA_DEMO_AGENT_ID = "clearsig-beta-demo:steady-btc";
const BETA_DEMO_SESSION_ID = "clearsig-beta-demo:steady-btc:allowance";

export interface AgentBetaDemoSetupResult {
  agent: AgentProfile;
  session: AgentSessionGrant;
  firstTradeOpened: boolean;
  historyTradesCreated: number;
  stoppedIdeasCreated: number;
}

export function setupAgentBetaDemo({
  walletName,
  now = Date.now(),
}: {
  walletName: string;
  now?: number;
}): AgentBetaDemoSetupResult {
  const template = clearSigTraderById("steady-btc");
  if (!template) {
    throw new Error("ClearSig beta demo trader is unavailable.");
  }
  const policy = saveAgentVaultPolicy({
    ...defaultAgentVaultPolicy(walletName, now),
    maxNotionalUsd: "250",
    maxLeverage: 1,
    maxOpenPositionsPerAgent: 2,
    cooldownSeconds: 0,
    maxSessionHours: 24,
    dailyLossCapUsd: "50",
    updatedAt: now,
  });
  const existingAgent = findAgent(walletName, BETA_DEMO_AGENT_ID);
  const agent = saveAgent({
    ...(existingAgent ??
      createClearSigLibraryTrader({
        template,
        walletName,
        id: BETA_DEMO_AGENT_ID,
        now,
      })),
    name: "Steady BTC Beta Demo",
    status: "active",
    updatedAt: now,
  });
  const session = saveAgentSession({
    id: BETA_DEMO_SESSION_ID,
    walletName,
    agentId: agent.id,
    status: "active",
    startsAt: now,
    expiresAt: now + 4 * 60 * 60 * 1000,
    allowedVenues: ["mock_perps"],
    allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "100",
    maxLeverage: 1,
    maxOpenPositions: 1,
    allocationTierId: "probation",
    createdAt: existingAgent?.createdAt ?? now,
    updatedAt: now,
    version: 1,
  });
  const alreadyHasOpen = listAgentExecutions(walletName).some(
    (execution) =>
      execution.agentId === agent.id &&
      execution.status === "open" &&
      execution.proposalId.startsWith("clearsig-beta-demo:first-trade"),
  );
  const proposal = alreadyHasOpen
    ? null
    : createClearSigLibraryPracticeIdea({
        agent,
        maxNotionalUsd: "100",
        id: `${"clearsig-beta-demo:first-trade"}:${newAgentProposalId()}`,
        now,
      });
  const first = proposal
    ? saveAgentProposalAndExecuteIfAllowed({
        ...proposal,
        status: "approved",
        clientSignalId: `${"clearsig-beta-demo:first-trade"}:${walletName}`,
        policyHash: policy.policyHash,
      })
    : null;
  const history = seedClearSigAgentDemoHistory({ walletName, now: now + 1 });
  return {
    agent,
    session,
    firstTradeOpened: Boolean(first?.execution) || alreadyHasOpen,
    historyTradesCreated: history.tradesCreated,
    stoppedIdeasCreated: history.stoppedIdeasCreated,
  };
}
