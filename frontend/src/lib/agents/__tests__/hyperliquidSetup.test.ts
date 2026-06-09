import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentHyperliquidSetupSummary,
  getAgentHyperliquidSetupSettings,
  saveAgentHyperliquidSetupSettings,
  updateAgentHyperliquidDelegationStatus,
} from "@/lib/agents/hyperliquidSetup";

const address = "0x1111111111111111111111111111111111111111";
const agentWallet = "0x2222222222222222222222222222222222222222";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Hyperliquid setup helpers", () => {
  it("stores a public testnet account address", () => {
    saveAgentHyperliquidSetupSettings("vault", {
      accountAddress: address.toUpperCase(),
      agentWalletAddress: agentWallet.toUpperCase(),
    });

    expect(getAgentHyperliquidSetupSettings("vault").accountAddress).toBe(address);
    expect(getAgentHyperliquidSetupSettings("vault").agentWalletAddress).toBe(agentWallet);
    expect(getAgentHyperliquidSetupSettings("vault").delegationStatus).toBe("active");
    expect(getAgentHyperliquidSetupSettings("vault").approvedAt).toEqual(expect.any(Number));
  });

  it("rejects invalid account addresses", () => {
    expect(() =>
      saveAgentHyperliquidSetupSettings("vault", { accountAddress: "bad" }),
    ).toThrow("valid 0x");
    expect(() =>
      saveAgentHyperliquidSetupSettings("vault", {
        accountAddress: address,
        agentWalletAddress: address,
      }),
    ).toThrow("separate API wallet");
  });

  it("summarizes setup from readiness probes", () => {
    const summary = buildAgentHyperliquidSetupSummary(
      {
        venue: "hyperliquid_testnet",
        label: "Hyperliquid Testnet",
        state: "ready",
        canSubmit: true,
        missingEnvVars: [],
        message: "Ready",
        accountProbe: {
          state: "funded",
          accountAddress: address,
          accountValueUsd: "100",
          withdrawableUsd: "100",
          openPositions: 0,
          message: "Funded",
        },
        executorProbe: {
          state: "ready",
          accountAddress: address,
          agentWalletAddress: agentWallet,
          message: "Ready",
        },
      },
      {
        accountAddress: address,
        agentWalletAddress: agentWallet,
        delegationStatus: "active",
        updatedAt: 1,
        version: 1,
      },
    );

    expect(summary.status).toBe("ready");
    expect(summary.steps.map((step) => step.status)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
  });

  it("tracks API wallet rotation and revocation status", () => {
    saveAgentHyperliquidSetupSettings("vault-lifecycle", {
      accountAddress: address,
      agentWalletAddress: agentWallet,
    });

    const rotating = updateAgentHyperliquidDelegationStatus({
      walletName: "vault-lifecycle",
      status: "rotation_required",
      reason: "Key was shared with the wrong executor.",
    });
    const revoked = updateAgentHyperliquidDelegationStatus({
      walletName: "vault-lifecycle",
      status: "revoked",
    });

    expect(rotating.delegationStatus).toBe("rotation_required");
    expect(rotating.rotationReason).toBe("Key was shared with the wrong executor.");
    expect(revoked.delegationStatus).toBe("revoked");
    expect(revoked.revokedAt).toEqual(expect.any(Number));
  });

  it("blocks setup readiness when the API wallet is revoked", () => {
    const settings = saveAgentHyperliquidSetupSettings("vault-revoked", {
      accountAddress: address,
      agentWalletAddress: agentWallet,
    });
    const revokedSettings = updateAgentHyperliquidDelegationStatus({
      walletName: "vault-revoked",
      status: "revoked",
    });
    const summary = buildAgentHyperliquidSetupSummary(
      {
        venue: "hyperliquid_testnet",
        label: "Hyperliquid Testnet",
        state: "ready",
        canSubmit: true,
        missingEnvVars: [],
        message: "Ready",
        accountProbe: {
          state: "funded",
          accountAddress: settings.accountAddress,
          accountValueUsd: "100",
          withdrawableUsd: "100",
          openPositions: 0,
          message: "Funded",
        },
        executorProbe: {
          state: "ready",
          accountAddress: settings.accountAddress,
          agentWalletAddress: settings.agentWalletAddress,
          message: "Ready",
        },
      },
      revokedSettings,
    );

    expect(summary.status).toBe("blocked");
    expect(summary.steps.find((step) => step.id === "agent_wallet")?.status).toBe(
      "blocked",
    );
  });
});
