import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPersistentPersonalPolicyTargets } from "@/lib/policies/persistentWalletPolicy";
import { saveAllowlist } from "@/lib/retail/policy";
import { sha256, toHex } from "@/lib/msig/hash";

function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    },
  });
}

describe("persistent Personal wallet policy", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
  });

  it("commits each remote allowlist only to its own chain slot", () => {
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

    const targets = buildPersistentPersonalPolicyTargets("Personal");
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
});
