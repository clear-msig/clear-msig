import { describe, expect, it } from "vitest";
import { buildAgentNotifications, defaultAgentVaultPolicy } from "@/lib/agents";
import type {
  AgentAuditEvent,
  AgentExecutionRecord,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent notifications", () => {
  it("builds priority notifications from durable agent state", () => {
    const summary = buildAgentNotifications({
      walletName: "vault",
      walletHref: "/app/wallet/vault",
      agents: [
        agent(),
        agent({
          id: "publishing-agent",
          name: "Publishing Agent",
          publishing: {
            status: "published",
            slug: "publishing-agent",
            publicSummary: "Testing publishing.",
            visibleMetrics: ["score"],
            moderation: {
              status: "pending_review",
              reason: "Waiting for review.",
              updatedAt: now,
              version: 1,
            },
            publishedAt: now,
            updatedAt: now,
            version: 1,
          },
        }),
      ],
      proposals: [
        proposal({ id: "needs", status: "needs_approval" }),
        proposal({
          id: "blocked",
          status: "blocked",
          policyViolations: [
            {
              code: "notional_too_large",
              severity: "block",
              message: "Trade is larger than the allowance.",
            },
          ],
        }),
      ],
      sessions: [session()],
      executions: [
        execution({ id: "open", status: "open" }),
        execution({ id: "closed-loss", status: "closed", realizedPnlUsd: "-12" }),
      ],
      events: [
        event({
          id: "pause",
          kind: "policy_emergency_pause_changed",
          message: "All automatic trading paused.",
        }),
        event({
          id: "approval",
          kind: "owner_action_approved",
          message: "Owner approved an allowance.",
        }),
      ],
      policy: {
        ...defaultAgentVaultPolicy("vault", now),
        emergencyPaused: true,
      },
      now,
    });

    expect(summary.critical).toBe(2);
    expect(summary.warning).toBeGreaterThanOrEqual(3);
    expect(summary.notifications.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "kill_switch",
        "trade_needs_approval",
        "trade_blocked",
        "trade_open",
        "trade_closed",
        "allowance_expiring",
        "publishing_review",
        "owner_action",
      ]),
    );
    expect(summary.notifications[0]?.severity).toBe("critical");
  });

  it("does not emit unrelated wallet notices", () => {
    const summary = buildAgentNotifications({
      walletName: "vault",
      walletHref: "/app/wallet/vault",
      agents: [agent({ walletName: "other" })],
      proposals: [proposal({ walletName: "other", status: "needs_approval" })],
      sessions: [],
      executions: [],
      events: [],
      policy: defaultAgentVaultPolicy("vault", now),
      now,
    });

    expect(summary.notifications).toEqual([]);
  });
});

function agent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: "vault",
    name: "Agent Alpha",
    kind: "api",
    status: "active",
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function proposal(overrides: Partial<AgentTradeProposal> = {}): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName: "vault",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    confidence: 70,
    expiresAt: now + 60_000,
    status: "needs_approval",
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function session(): AgentSessionGrant {
  return {
    id: "session-1",
    walletName: "vault",
    agentId: "agent-alpha",
    status: "active",
    startsAt: now - 60_000,
    expiresAt: now + 45 * 60_000,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function execution(overrides: Partial<AgentExecutionRecord> = {}): AgentExecutionRecord {
  return {
    id: "execution-1",
    walletName: "vault",
    proposalId: "proposal-1",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    status: "open",
    openedAt: now,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
    ...overrides,
  };
}

function event(overrides: Partial<AgentAuditEvent> = {}): AgentAuditEvent {
  return {
    id: "event-1",
    walletName: "vault",
    kind: "owner_action_approved",
    message: "Owner action.",
    createdAt: now,
    version: 1,
    ...overrides,
  };
}

