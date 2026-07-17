import { afterEach, describe, expect, it } from "vitest";
import {
  agentAutomaticTradingEnabled,
  enqueueAgentSignal,
  listAgentInboxSignals,
  registerAgentSignalKey,
  removeAgentInboxSignals,
  verifyAgentManagementKey,
  verifyAgentSignalKey,
} from "@/lib/agents/serverInbox";
import { sampleAgentSignalPayload } from "@/lib/agents";

afterEach(() => {
  delete process.env.CLEARSIG_AGENT_SIGNAL_LIMIT_PER_MINUTE;
});

describe("agent server signal inbox", () => {
  it("registers signal keys, queues signals, and removes imported items", async () => {
    await registerAgentSignalKey({
      walletName: "vault-inbox",
      agentId: "agent-alpha",
      signalKey: "cs_sig_test_key",
      managementKey: "cs_mgmt_test_key",
      autoImportSessionSignals: true,
    });

    expect(
      await verifyAgentManagementKey({
        walletName: "vault-inbox",
        agentId: "agent-alpha",
        managementKey: "cs_mgmt_test_key",
      }),
    ).toBe(true);
    expect(await agentAutomaticTradingEnabled("vault-inbox", "agent-alpha")).toBe(true);
    expect(
      await verifyAgentManagementKey({
        walletName: "vault-inbox",
        agentId: "agent-alpha",
        managementKey: "wrong",
      }),
    ).toBe(false);
    expect(
      await verifyAgentSignalKey({
        walletName: "vault-inbox",
        agentId: "agent-alpha",
        signalKey: "cs_sig_test_key",
      }),
    ).toBe(true);
    expect(
      await verifyAgentSignalKey({
        walletName: "vault-inbox",
        agentId: "agent-alpha",
        signalKey: "wrong",
      }),
    ).toBe(false);

    const payload = {
      ...sampleAgentSignalPayload(),
      clientSignalId: "retry-1",
    };
    const queued = await enqueueAgentSignal({
      walletName: "vault-inbox",
      agentId: "agent-alpha",
      payload,
    });
    const duplicate = await enqueueAgentSignal({
      walletName: "vault-inbox",
      agentId: "agent-alpha",
      payload,
    });

    expect(queued.duplicate).toBe(false);
    expect(queued.accepted).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.item.id).toBe(queued.item.id);
    expect(await listAgentInboxSignals("vault-inbox", "agent-alpha")).toHaveLength(1);
    expect(await removeAgentInboxSignals("vault-inbox", "agent-alpha", [queued.item.id])).toBe(1);
    expect(await listAgentInboxSignals("vault-inbox", "agent-alpha")).toHaveLength(0);
  });

  it("does not let a signal key replace the inbox management key", async () => {
    await registerAgentSignalKey({
      walletName: "vault-locked-inbox",
      agentId: "agent-alpha",
      signalKey: "cs_sig_first_key",
      managementKey: "cs_mgmt_owner_key",
    });

    await expect(
      registerAgentSignalKey({
        walletName: "vault-locked-inbox",
        agentId: "agent-alpha",
        signalKey: "cs_sig_second_key",
        managementKey: "cs_sig_first_key",
      }),
    ).rejects.toThrow("Invalid inbox management key.");

    expect(
      await verifyAgentSignalKey({
        walletName: "vault-locked-inbox",
        agentId: "agent-alpha",
        signalKey: "cs_sig_first_key",
      }),
    ).toBe(true);
  });

  it("rejects missing metadata, disallowed origins, and rate-limit bursts", async () => {
    const now = Date.UTC(2026, 5, 9, 12, 0, 0);
    await registerAgentSignalKey({
      walletName: "vault-abuse-inbox",
      agentId: "agent-alpha",
      signalKey: "cs_sig_abuse_key",
      managementKey: "cs_mgmt_abuse_key",
      allowedOrigins: ["https://agent.example/signals"],
    });

    const missingMetadata = await enqueueAgentSignal({
      walletName: "vault-abuse-inbox",
      agentId: "agent-alpha",
      now,
      payload: {
        ...sampleAgentSignalPayload(),
        clientSignalId: "",
        submittedAt: now,
      },
      origin: "https://agent.example",
    });
    const wrongOrigin = await enqueueAgentSignal({
      walletName: "vault-abuse-inbox",
      agentId: "agent-alpha",
      now,
      payload: {
        ...sampleAgentSignalPayload(),
        clientSignalId: "origin-1",
        submittedAt: now,
      },
      origin: "https://bad.example",
    });

    process.env.CLEARSIG_AGENT_SIGNAL_LIMIT_PER_MINUTE = "1";
    const accepted = await enqueueAgentSignal({
      walletName: "vault-rate-inbox",
      agentId: "agent-alpha",
      now,
      payload: {
        ...sampleAgentSignalPayload(),
        clientSignalId: "rate-1",
        submittedAt: now,
      },
    });
    const limited = await enqueueAgentSignal({
      walletName: "vault-rate-inbox",
      agentId: "agent-alpha",
      now: now + 1_000,
      payload: {
        ...sampleAgentSignalPayload(),
        clientSignalId: "rate-2",
        submittedAt: now + 1_000,
      },
    });

    expect(missingMetadata.accepted).toBe(false);
    expect(missingMetadata.abuseFlags).toContain("missing_client_signal_id");
    expect(wrongOrigin.accepted).toBe(false);
    expect(wrongOrigin.abuseFlags).toContain("origin_not_allowed");
    expect(accepted.accepted).toBe(true);
    expect(limited.accepted).toBe(false);
    expect(limited.abuseFlags).toContain("rate_limit_exceeded");
  });
});
