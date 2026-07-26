import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentBetaFeedback,
  listAgentBetaFeedback,
  saveAgentBetaFeedback,
} from "@/lib/agents/betaFeedback";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

beforeEach(() => {
  stubBrowserStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent beta feedback", () => {
  it("stores feedback scoped by wallet", () => {
    saveAgentBetaFeedback({
      walletName: "vault",
      route: "/app/wallet/vault/agents",
      kind: "bug",
      message: "Automatic trading copy is unclear.",
      contact: "micah@example.com",
      now,
    });
    saveAgentBetaFeedback({
      walletName: "other",
      route: "/app/wallet/other/agents",
      kind: "other",
      message: "Other wallet feedback.",
      now,
    });

    expect(listAgentBetaFeedback("vault")).toHaveLength(1);
    expect(listAgentBetaFeedback("vault")[0]?.contact).toBe("micah@example.com");
  });

  it("clears feedback for one wallet", () => {
    saveAgentBetaFeedback({
      walletName: "vault",
      route: "/app/wallet/vault/agents",
      kind: "trust",
      message: "Show approval scope.",
      now,
    });

    clearAgentBetaFeedback("vault");

    expect(listAgentBetaFeedback("vault")).toHaveLength(0);
  });

  it("requires a message", () => {
    expect(() =>
      saveAgentBetaFeedback({
        walletName: "vault",
        route: "/app/wallet/vault/agents",
        kind: "bug",
        message: " ",
        now,
      }),
    ).toThrow("Feedback message is required.");
  });
});

function stubBrowserStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      clear: () => store.clear(),
    },
  } as never);
}
