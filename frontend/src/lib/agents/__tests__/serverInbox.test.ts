import { describe, expect, it } from "vitest";
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
    expect(duplicate.duplicate).toBe(true);
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
});
