import { describe, expect, it } from "vitest";
import { RequestRecoveryStore } from "../requestRecovery";
const address = "11111111111111111111111111111111";
const identity = {
  walletName: "Ops",
  endpoint: "mock://rpc",
  accountKey: "aa".repeat(32),
  label: "Quorum change",
  identity: ["canonical-wallet", 0, 2],
};
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}
describe("governance and policy recovery metadata (synthetic, no wallet/RPC)", () => {
  it("blocks duplicate preparation before any accepted work", () => {
    const s = new RequestRecoveryStore();
    const a = s.begin(identity);
    expect(() => s.begin(identity)).toThrow("already being prepared");
    a.finish();
    expect(() => s.begin(identity)).not.toThrow();
  });
  it("retains uncertain submission across navigation/reload and never asserts creation", () => {
    const storageLike = storage(),
      s = new RequestRecoveryStore(storageLike);
    const a = s.begin(identity);
    a.submitting(address);
    a.finish();
    const restored = new RequestRecoveryStore(storageLike);
    expect(() => restored.begin(identity)).toThrow("outcome is uncertain");
    expect(restored.snapshot()[0]?.outcome).toBe("unknown");
  });
  it("retains accepted requests on later approval/execution error", () => {
    const s = new RequestRecoveryStore();
    const a = s.begin(identity);
    a.submitting(address);
    a.accepted(address);
    a.finish();
    expect(() => s.begin(identity)).toThrow("already created");
  });
  it("allows distinct desired payloads and isolates auth/RPC identity", () => {
    const s = new RequestRecoveryStore();
    const a = s.begin(identity);
    a.accepted(address);
    a.finish();
    expect(() =>
      s.begin({ ...identity, identity: ["canonical-wallet", 0, 3] }),
    ).not.toThrow();
    expect(() =>
      s.begin({ ...identity, accountKey: "bb".repeat(32) }),
    ).not.toThrow();
    expect(() =>
      s.begin({ ...identity, endpoint: "mock://other" }),
    ).not.toThrow();
  });
  it("clears only confirmed completion, or deliberate separate-request acknowledgement", () => {
    const s = new RequestRecoveryStore();
    const a = s.begin(identity);
    a.accepted(address);
    const key = s.snapshot()[0].key;
    expect(() => s.acknowledgeSeparateRequest(key)).toThrow("Wait");
    a.finish();
    s.acknowledgeSeparateRequest(key);
    const b = s.begin(identity);
    b.accepted(address);
    b.complete();
    b.finish();
    expect(s.snapshot()).toEqual([]);
  });
  it("persists only identifiers, not policy plaintext, signatures, or auth subject", () => {
    const st = storage(),
      s = new RequestRecoveryStore(st);
    const a = s.begin({
      ...identity,
      identity: { secretPolicyMarker: "private details" },
    });
    a.submitting(address);
    a.finish();
    expect(JSON.stringify(s.snapshot())).not.toContain("private details");
    expect(Object.keys(s.snapshot()[0]).sort()).toEqual([
      "accountKey",
      "endpoint",
      "key",
      "label",
      "outcome",
      "proposal",
      "walletName",
    ]);
  });
  it("ignores malformed local metadata and works with unavailable session storage", () => {
    const s = new RequestRecoveryStore({
      getItem: () => "malformed",
      setItem: () => {
        throw Error();
      },
    });
    expect(s.snapshot()).toEqual([]);
    const a = s.begin(identity);
    a.submitting(address);
    a.finish();
    expect(() => s.begin(identity)).toThrow("uncertain");
  });
  it("an accepted late response remains attached to its original account", () => {
    const s = new RequestRecoveryStore();
    const old = s.begin(identity);
    old.submitting(address);
    const current = s.begin({ ...identity, accountKey: "bb".repeat(32) });
    old.accepted(address);
    old.finish();
    expect(s.snapshot()[0].accountKey).toBe(identity.accountKey);
    expect(
      s.snapshot().filter((entry) => entry.accountKey === "bb".repeat(32)),
    ).toEqual([]);
    current.finish();
  });
});
