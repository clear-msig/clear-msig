import type {
  AgentLeaderboardEntry,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";
import type { AgentServerWalletState } from "@/lib/agents/serverState";

export interface AgentBackendStateSnapshot {
  storage: "redis" | "memory";
  state: AgentServerWalletState;
  leaderboard: AgentLeaderboardEntry[];
}

export interface AgentBackendActionResult<T> {
  ok: boolean;
  message: string;
  value?: T;
}

export async function loadAgentBackendState(
  walletName: string,
): Promise<AgentBackendActionResult<AgentBackendStateSnapshot>> {
  try {
    const response = await fetch(agentStateUrl(walletName), {
      method: "GET",
      cache: "no-store",
    });
    const body = await safeJson(response);
    if (!response.ok || body.ok !== true) {
      return {
        ok: false,
        message: stringField(body, "error") || "Backend state is unavailable.",
      };
    }
    return {
      ok: true,
      message: "Backend state loaded.",
      value: {
        storage: body.storage === "redis" ? "redis" : "memory",
        state: body.state as AgentServerWalletState,
        leaderboard: Array.isArray(body.leaderboard)
          ? (body.leaderboard as AgentLeaderboardEntry[])
          : [],
      },
    };
  } catch (error) {
    return failed(error, "Backend state is unavailable.");
  }
}

export function syncAgentProfile(
  agent: AgentProfile,
): Promise<AgentBackendActionResult<AgentProfile>> {
  return postAgentStateAction<AgentProfile>(
    agent.walletName,
    "upsert_agent",
    agent,
    "agent",
  );
}

export function syncAgentVaultPolicy(
  policy: AgentVaultPolicy,
): Promise<AgentBackendActionResult<AgentVaultPolicy>> {
  return postAgentStateAction<AgentVaultPolicy>(
    policy.walletName,
    "upsert_policy",
    policy,
    "policy",
  );
}

export function syncAgentEmergencyPause(
  walletName: string,
  emergencyPaused: boolean,
): Promise<AgentBackendActionResult<AgentVaultPolicy>> {
  return postAgentStateAction<AgentVaultPolicy>(
    walletName,
    "set_emergency_pause",
    { emergencyPaused },
    "policy",
  );
}

export function syncAgentOwnerApproval(
  approval: AgentOwnerApproval,
): Promise<AgentBackendActionResult<AgentOwnerApproval>> {
  return postAgentStateAction<AgentOwnerApproval>(
    approval.walletName,
    "record_owner_approval",
    approval,
    "approval",
  );
}

export function syncAgentSession(
  session: AgentSessionGrant,
): Promise<AgentBackendActionResult<AgentSessionGrant>> {
  return postAgentStateAction<AgentSessionGrant>(
    session.walletName,
    "upsert_session",
    session,
    "session",
  );
}

export function syncAgentSessionStatus(
  walletName: string,
  id: string,
  status: AgentSessionGrant["status"],
): Promise<AgentBackendActionResult<AgentSessionGrant>> {
  return postAgentStateAction<AgentSessionGrant>(
    walletName,
    "update_session_status",
    { id, status },
    "session",
  );
}

export function syncAgentProposal(
  proposal: AgentTradeProposal,
): Promise<AgentBackendActionResult<AgentTradeProposal>> {
  return postAgentStateAction<AgentTradeProposal>(
    proposal.walletName,
    "save_proposal",
    proposal,
    "proposal",
  );
}

export function syncAgentProposalApproval(
  walletName: string,
  id: string,
): Promise<AgentBackendActionResult<AgentTradeProposal>> {
  return postAgentStateAction<AgentTradeProposal>(
    walletName,
    "approve_proposal",
    { id },
    "proposal",
  );
}

export function syncAgentProposalRejection(
  walletName: string,
  id: string,
): Promise<AgentBackendActionResult<AgentTradeProposal>> {
  return postAgentStateAction<AgentTradeProposal>(
    walletName,
    "reject_proposal",
    { id },
    "proposal",
  );
}

export function syncAgentExecution(
  execution: AgentExecutionRecord,
): Promise<AgentBackendActionResult<AgentExecutionRecord>> {
  return postAgentStateAction<AgentExecutionRecord>(
    execution.walletName,
    "upsert_execution",
    execution,
    "execution",
  );
}

async function postAgentStateAction<T>(
  walletName: string,
  action: string,
  payload: unknown,
  valueField: string,
): Promise<AgentBackendActionResult<T>> {
  try {
    const response = await fetch(agentStateUrl(walletName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const body = await safeJson(response);
    if (!response.ok || body.ok !== true) {
      return {
        ok: false,
        message: stringField(body, "error") || "Backend sync failed.",
      };
    }
    return {
      ok: true,
      message: "Backend sync complete.",
      value: body[valueField] as T | undefined,
    };
  } catch (error) {
    return failed(error, "Backend sync failed.");
  }
}

function agentStateUrl(walletName: string): string {
  return `/api/agent-state/${encodeURIComponent(walletName)}`;
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

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  return typeof value === "string" ? value : "";
}

function failed<T>(
  error: unknown,
  fallback: string,
): AgentBackendActionResult<T> {
  return {
    ok: false,
    message: error instanceof Error ? error.message : fallback,
  };
}
