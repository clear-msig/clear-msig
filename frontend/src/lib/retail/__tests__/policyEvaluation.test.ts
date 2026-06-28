import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluatePolicy } from "@/lib/retail/policyEvaluation";
import { saveEmergencyPause } from "@/lib/retail/policy";

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

  it("blocks sends when emergency pause is on", () => {
    saveEmergencyPause("Family", true);

    const result = evaluatePolicy({
      walletName: "Family",
      recipientAddress: "11111111111111111111111111111111",
    });

    expect(result.ok).toBe(false);
    expect(result.hasActiveRules).toBe(true);
    expect(result.violations).toContainEqual({
      code: "emergency_paused",
      title: "Sends are paused",
      body: "This wallet is paused for safety. Turn sending back on from Protection when you are ready.",
    });
  });

  it("allows sends when emergency pause is off", () => {
    saveEmergencyPause("Family", false);

    const result = evaluatePolicy({
      walletName: "Family",
      recipientAddress: "11111111111111111111111111111111",
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
