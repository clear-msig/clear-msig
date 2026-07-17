import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeAgentComplianceDisclosures,
  buildAgentComplianceReadiness,
  getAgentComplianceAcknowledgement,
  hasAgentComplianceAcknowledgement,
  requiredAgentComplianceDisclosures,
} from "@/lib/agents/compliance";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: makeLocalStorageStub(),
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent compliance disclosures", () => {
  it("requires the current disclosure set before launch", () => {
    const readiness = buildAgentComplianceReadiness("vault", "mock_perps");

    expect(readiness.accepted).toBe(false);
    expect(readiness.required).toHaveLength(6);
    expect(readiness.missing.map((item) => item.id)).toEqual(
      requiredAgentComplianceDisclosures("mock_perps").map((item) => item.id),
    );
  });

  it("stores per-wallet, per-venue acknowledgement", () => {
    const acknowledgement = acknowledgeAgentComplianceDisclosures({
      walletName: "vault",
      venue: "hyperliquid_testnet",
      now,
    });

    expect(acknowledgement.disclosureIds).toHaveLength(6);
    expect(hasAgentComplianceAcknowledgement("vault", "hyperliquid_testnet")).toBe(true);
    expect(hasAgentComplianceAcknowledgement("vault", "mock_perps")).toBe(false);
    expect(
      getAgentComplianceAcknowledgement("vault", "hyperliquid_testnet")?.acknowledgedAt,
    ).toBe(now);
  });
});
