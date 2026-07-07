import { describe, expect, it } from "vitest";
import {
  hashAgentServerExecutionArtifact,
  listAgentServerExecutionRequests,
  recordAgentServerExecutionRequest,
} from "@/lib/agents/serverExecutionRequests";
import type {
  AgentServerExecutionReadiness,
  AgentServerExecutionRequest,
} from "@/lib/agents/serverExecutionAdapters";

const request: AgentServerExecutionRequest = {
  walletName: "vault-execution-ledger",
  agentId: "agent-alpha",
  proposalId: "proposal-1",
  venue: "hyperliquid_testnet",
  market: "BTC-PERP",
  side: "long",
  orderType: "market",
  notionalUsd: "250",
  leverage: 1,
  approvedAt: 1_700_000_000,
};

const readiness: AgentServerExecutionReadiness = {
  venue: "hyperliquid_testnet",
  label: "Hyperliquid Testnet",
  state: "not_configured",
  canSubmit: false,
  missingEnvVars: ["CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN"],
  message: "Server trading is not configured for this venue yet.",
};

describe("server execution request ledger", () => {
  it("records venue handoffs and deduplicates by proposal and venue", async () => {
    const first = await recordAgentServerExecutionRequest({ request, readiness });
    const duplicate = await recordAgentServerExecutionRequest({ request, readiness });
    const list = await listAgentServerExecutionRequests(
      request.walletName,
      request.agentId,
    );

    expect(first.duplicate).toBe(false);
    expect(first.record.status).toBe("waiting_for_setup");
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record.id).toBe(first.record.id);
    expect(list).toHaveLength(1);
  });

  it("records ready venues as adapter-not-connected until the real adapter exists", async () => {
    const result = await recordAgentServerExecutionRequest({
      request: {
        ...request,
        walletName: "vault-execution-ready",
        proposalId: "proposal-ready",
      },
      readiness: {
        ...readiness,
        state: "ready",
        canSubmit: true,
        missingEnvVars: [],
        message: "Server trading credentials are present.",
      },
    });

    expect(result.record.status).toBe("adapter_not_connected");
    expect(result.record.readinessState).toBe("ready");
  });

  it("lets a later valid handoff replace a rejected attempt", async () => {
    const rejected = await recordAgentServerExecutionRequest({
      request: {
        ...request,
        walletName: "vault-execution-retry",
        proposalId: "proposal-retry",
      },
      readiness,
      status: "rejected",
      message: "Trade signal is not present in backend agent state.",
    });
    const accepted = await recordAgentServerExecutionRequest({
      request: {
        ...request,
        walletName: "vault-execution-retry",
        proposalId: "proposal-retry",
      },
      readiness,
    });
    const duplicate = await recordAgentServerExecutionRequest({
      request: {
        ...request,
        walletName: "vault-execution-retry",
        proposalId: "proposal-retry",
      },
      readiness,
    });

    expect(rejected.record.status).toBe("rejected");
    expect(accepted.duplicate).toBe(false);
    expect(accepted.record.status).toBe("waiting_for_setup");
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record.id).toBe(accepted.record.id);
  });

  it("records a verified submitted artifact and deduplicates it", async () => {
    const submittedRequest = {
      ...request,
      walletName: "vault-execution-submitted",
      proposalId: "proposal-submitted",
    };
    const first = await recordAgentServerExecutionRequest({
      request: submittedRequest,
      readiness: {
        ...readiness,
        state: "ready",
        canSubmit: true,
        missingEnvVars: [],
      },
      status: "submitted",
      message: "Hyperliquid testnet order 123 was filled.",
      artifact: {
        exchange: "hyperliquid_testnet",
        orderId: "123",
        status: "filled",
        market: "BTC-PERP",
        side: "long",
        submittedAt: 1_780_000_000_000,
      },
    });
    const duplicate = await recordAgentServerExecutionRequest({
      request: submittedRequest,
      readiness,
      status: "submitted",
    });

    expect(first.record.status).toBe("submitted");
    expect(first.record.artifact?.orderId).toBe("123");
    expect(first.record.artifactHash).toBe(
      hashAgentServerExecutionArtifact(first.record.artifact!),
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record.artifactHash).toBe(first.record.artifactHash);
  });

  it("hashes submitted artifacts with stable key ordering", () => {
    const first = hashAgentServerExecutionArtifact({
      exchange: "hyperliquid_testnet",
      orderId: "123",
      status: "filled",
      market: "BTC-PERP",
      side: "long",
      submittedAt: 1_780_000_000_000,
    });
    const second = hashAgentServerExecutionArtifact({
      submittedAt: 1_780_000_000_000,
      side: "long",
      market: "BTC-PERP",
      status: "filled",
      orderId: "123",
      exchange: "hyperliquid_testnet",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });
});
