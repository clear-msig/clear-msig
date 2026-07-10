import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluatePolicy } from "@/lib/retail/policyEvaluation";
import { saveAllowlist } from "@/lib/retail/policy";

function installStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };

  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: vi.fn(),
  });
}

describe("retail policy evaluation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
  });

  it("blocks sends to recipients outside the saved allowlist", () => {
    saveAllowlist({ walletName: "Family", mode: "on", addresses: ["allowed"] });

    const result = evaluatePolicy({
      walletName: "Family",
      recipientAddress: "not-allowed",
    });

    expect(result.ok).toBe(false);
    expect(result.hasActiveRules).toBe(true);
    expect(result.violations).toContainEqual({
      code: "recipient_not_allowed",
      title: "That recipient isn't on the allowlist",
      body: "This wallet only sends to addresses on its allowlist. Add the recipient on the policy page first, or send from a wallet that doesn't have the allowlist on.",
    });
  });

  it("allows recipients present in the saved allowlist", () => {
    saveAllowlist({ walletName: "Family", mode: "on", addresses: ["allowed"] });

    const result = evaluatePolicy({
      walletName: "Family",
      recipientAddress: "allowed",
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
