import type {
  AgentAuditEvent,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentPolicyEvaluation,
  AgentProfile,
  AgentScorecard,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

export interface AgentServerWalletState {
  walletName: string;
  agents: AgentProfile[];
  policy: AgentVaultPolicy;
  proposals: AgentTradeProposal[];
  sessions: AgentSessionGrant[];
  executions: AgentExecutionRecord[];
  events: AgentAuditEvent[];
  approvals: AgentOwnerApproval[];
  scorecards: Record<string, AgentScorecard>;
  updatedAt: number;
  version: 1;
}

export interface AgentServerProposalSaveResult {
  proposal: AgentTradeProposal;
  evaluation: AgentPolicyEvaluation | null;
  duplicate: boolean;
}

export interface AgentServerExecutionGateResult {
  allowed: boolean;
  message: string;
  proposal: AgentTradeProposal | null;
  evaluation: AgentPolicyEvaluation | null;
}

export class AgentServerStateConflictError extends Error {}
export class AgentServerStatePersistenceError extends Error {}
