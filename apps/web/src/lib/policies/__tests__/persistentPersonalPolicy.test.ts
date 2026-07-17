import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPersistentPersonalPolicyTargets } from "@/lib/policies/persistentWalletPolicy";
import { saveAllowlist } from "@/lib/retail/policy";
import { sha256, toHex } from "@/lib/msig/hash";
import { savePolicy } from "@/lib/policies/storage";
import { saveAllowance } from "@/lib/retail/allowances";

function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    },
    dispatchEvent: vi.fn(),
  });
}

describe("persistent Personal wallet policy", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
  });

  it("commits each remote allowlist only to its own chain slot", async () => {
    const ethRecipient = "0x1111111111111111111111111111111111111111";
    const btcRecipient = "tb1qfm4vy9x7czm5h7xk5r43gr0p4kr5z78e3k8h7m";
    saveAllowlist({
      walletName: "Personal",
      chainKind: 1,
      mode: "on",
      addresses: [ethRecipient],
    });
    saveAllowlist({
      walletName: "Personal",
      chainKind: 2,
      mode: "on",
      addresses: [btcRecipient],
    });

    const targets = await buildPersistentPersonalPolicyTargets("Personal");
    const eth = targets.find((target) => target.chainKind === 1)!;
    const btc = targets.find((target) => target.chainKind === 2)!;
    const zec = targets.find((target) => target.chainKind === 3)!;

    expect(eth.policyBytesHex.slice(8, 10)).toBe("01");
    expect(eth.policyBytesHex).toContain(
      toHex(sha256(new TextEncoder().encode(ethRecipient))),
    );
    expect(btc.policyBytesHex).toContain(
      toHex(sha256(new TextEncoder().encode(btcRecipient))),
    );
    expect(zec.policyBytesHex).toBe("");
  });

  it("commits ordered advanced BTC rules into the static on-chain policy", async () => {
    savePolicy({
      id: "deny-large-btc",
      walletName: "Personal",
      name: "Deny large BTC sends",
      priority: 100,
      enabled: true,
      conditions: [
        { kind: "asset", chainKind: 2 },
        { kind: "amount", minDisplay: "0.01", ticker: "BTC" },
      ],
      action: "deny",
      updatedAt: 2,
      createdAt: 1,
      version: 1,
    });

    const targets = await buildPersistentPersonalPolicyTargets("Personal");
    const btc = targets.find((target) => target.chainKind === 2)!;
    const eth = targets.find((target) => target.chainKind === 1)!;

    expect(btc.policyBytesHex.slice(38, 40)).toBe("05");
    expect(btc.policyBytesHex.length).toBeGreaterThan(38);
    expect(eth.policyBytesHex).toBe("");
  });

  it("commits member limits only to the SOL member ledger extension", async () => {
    saveAllowance({
      walletName: "Pro",
      friendAddress: "11111111111111111111111111111111",
      amountSol: 1.25,
      period: "weekly",
    });

    const targets = await buildPersistentPersonalPolicyTargets("Pro");
    const sol = targets.find((target) => target.chainKind === 0)!;
    const eth = targets.find((target) => target.chainKind === 1)!;

    expect(sol.policyBytesHex.slice(38, 40)).toBe("04");
    expect(sol.policyBytesHex).toContain("807c814a00000000");
    expect(eth.policyBytesHex).toBe("");
  });
});
