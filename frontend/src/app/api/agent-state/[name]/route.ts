import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  AgentServerStateConflictError,
  agentServerLeaderboard,
  agentServerStateStorageMode,
  approveAgentServerProposal,
  getAgentServerWalletState,
  hasAgentServerWalletSignedOwnerApproval,
  rejectAgentServerProposal,
  saveAgentServerExecution,
  saveAgentServerOwnerApproval,
  saveAgentServerProfile,
  saveAgentServerProposal,
  saveAgentServerSession,
  saveAgentServerVaultPolicy,
  setAgentServerEmergencyPause,
  updateAgentServerSessionStatus,
} from "@/lib/agents/serverState";
import type {
  AgentProfile,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

const MAX_BODY_BYTES = 20_000;

interface RouteContext {
  params: Promise<{
    name: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const walletName = decodeRouteParam((await context.params).name);
  const state = await getAgentServerWalletState(walletName);
  return NextResponse.json({
    ok: true,
    storage: agentServerStateStorageMode(),
    state,
    leaderboard: await agentServerLeaderboard(walletName),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const limited = await checkRateLimit("agent-state", clientIp(request), {
    capacity: 30,
    refillPerSec: 1 / 3,
  });
  if (limited) return limited;

  const walletName = decodeRouteParam((await context.params).name);
  const raw = await readBoundedBody(request);
  if (!raw.ok) return raw.response;

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const action = readStringField(body, "action");
  const payload = readObjectField(body, "payload");
  if (!action || !payload) {
    return NextResponse.json(
      { error: "Action and payload are required." },
      { status: 400 },
    );
  }

  try {
    if (action === "upsert_agent") {
      const agent = payload as unknown as AgentProfile;
      if (!sameWallet(walletName, agent.walletName) || !agent.id || !agent.name) {
        return NextResponse.json({ error: "Invalid agent payload." }, { status: 400 });
      }
      return NextResponse.json({ ok: true, agent: await saveAgentServerProfile(agent) });
    }

    if (action === "upsert_policy") {
      const policy = payload as unknown as AgentVaultPolicy;
      if (!sameWallet(walletName, policy.walletName)) {
        return NextResponse.json({ error: "Invalid policy payload." }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        policy: await saveAgentServerVaultPolicy(policy),
      });
    }

    if (action === "set_emergency_pause") {
      const emergencyPaused = Boolean(payload.emergencyPaused);
      return NextResponse.json({
        ok: true,
        policy: await setAgentServerEmergencyPause(walletName, emergencyPaused),
      });
    }

    if (action === "record_owner_approval") {
      const approval = payload as unknown as AgentOwnerApproval;
      if (
        !sameWallet(walletName, approval.walletName) ||
        !approval.id ||
        !approval.action ||
        !approval.summary ||
        !approval.approvalHash
      ) {
        return NextResponse.json({ error: "Invalid approval payload." }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        approval: await saveAgentServerOwnerApproval(approval),
      });
    }

    if (action === "upsert_session") {
      const session = payload as unknown as AgentSessionGrant;
      if (!sameWallet(walletName, session.walletName) || !session.id || !session.agentId) {
        return NextResponse.json({ error: "Invalid session payload." }, { status: 400 });
      }
      if (
        session.status === "active" &&
        !(await hasAgentServerWalletSignedOwnerApproval({
          walletName,
          agentId: session.agentId,
          action: "grant_allowance",
          targetType: "session",
          targetId: session.id,
        }))
      ) {
        return NextResponse.json(
          { error: "Active allowances require a wallet-signed owner approval." },
          { status: 409 },
        );
      }
      return NextResponse.json({
        ok: true,
        session: await saveAgentServerSession(session),
      });
    }

    if (action === "update_session_status") {
      const status = readStringField(payload, "status");
      if (!isSessionStatus(status)) {
        return NextResponse.json({ error: "Invalid session status." }, { status: 400 });
      }
      const result = await updateAgentServerSessionStatus({
        walletName,
        id: readStringField(payload, "id"),
        status,
      });
      if (!result) return NextResponse.json({ error: "Session not found." }, { status: 404 });
      return NextResponse.json({ ok: true, session: result });
    }

    if (action === "save_proposal") {
      const proposal = payload as unknown as AgentTradeProposal;
      if (!sameWallet(walletName, proposal.walletName) || !proposal.id || !proposal.agentId) {
        return NextResponse.json({ error: "Invalid proposal payload." }, { status: 400 });
      }
      const result = await saveAgentServerProposal(proposal);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "approve_proposal") {
      const result = await approveAgentServerProposal(
        walletName,
        readStringField(payload, "id"),
      );
      if (!result) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "reject_proposal") {
      const proposal = await rejectAgentServerProposal(
        walletName,
        readStringField(payload, "id"),
      );
      if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
      return NextResponse.json({ ok: true, proposal });
    }

    if (action === "upsert_execution") {
      const execution = payload as unknown as AgentExecutionRecord;
      if (
        !sameWallet(walletName, execution.walletName) ||
        !execution.id ||
        !execution.agentId ||
        !execution.proposalId ||
        !isExecutionStatus(execution.status)
      ) {
        return NextResponse.json({ error: "Invalid execution payload." }, { status: 400 });
      }
      const existing = (await getAgentServerWalletState(walletName)).executions.find(
        (item) => item.id === execution.id,
      );
      if (existing?.status === "open" && execution.status === "closed") {
        const hasSingleTradeApproval = await hasAgentServerWalletSignedOwnerApproval({
          walletName,
          agentId: execution.agentId,
          action: "close_practice_trade",
          targetType: "execution",
          targetId: execution.id,
        });
        const hasBulkApproval = await hasAgentServerWalletSignedOwnerApproval({
          walletName,
          agentId: execution.agentId,
          action: "close_all_practice_trades",
          targetType: "agent",
          targetId: execution.agentId,
        });
        if (!hasSingleTradeApproval && !hasBulkApproval) {
          return NextResponse.json(
            {
              error:
                "Closing a recorded trade needs wallet approval before ClearSig can save it permanently.",
            },
            { status: 409 },
          );
        }
      }
      return NextResponse.json({
        ok: true,
        execution: await saveAgentServerExecution(execution),
      });
    }
  } catch (error) {
    if (error instanceof AgentServerStateConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[agent-state] action failed", error);
    return NextResponse.json(
      { error: "Agent state store is unavailable." },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

async function readBoundedBody(
  request: NextRequest,
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Agent state body is too large." },
        { status: 413 },
      ),
    };
  }
  return { ok: true, text };
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readStringField(input: unknown, field: string): string {
  if (!input || typeof input !== "object") return "";
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function readObjectField(input: unknown, field: string): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameWallet(routeWalletName: string, payloadWalletName: string): boolean {
  return routeWalletName === payloadWalletName;
}

function isSessionStatus(value: string): value is AgentSessionGrant["status"] {
  return (
    value === "active" ||
    value === "paused" ||
    value === "expired" ||
    value === "revoked"
  );
}

function isExecutionStatus(value: string): value is AgentExecutionRecord["status"] {
  return value === "open" || value === "closed";
}
