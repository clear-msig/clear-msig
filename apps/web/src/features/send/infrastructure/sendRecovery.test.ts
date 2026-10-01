import { describe, expect, it } from "vitest";
import { SendRecovery } from "./sendRecovery";
const address = "11111111111111111111111111111111";
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
describe("send recovery admission and consequential work", () => {
  it("rejects a same-tick double click before work starts", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    expect(() => r.begin()).toThrow("in progress");
    a.finish();
    expect(() => r.begin()).not.toThrow();
  });
  it("keeps uncertain submission across unmount/reload and prohibits blind retry", () => {
    const s = storage(),
      r = new SendRecovery("wallet-a", s);
    const a = r.begin();
    a.submitting(address);
    a.finish();
    const restored = new SendRecovery("wallet-a", s);
    expect(restored.saved()).toEqual({ proposal: address, outcome: "unknown" });
    expect(() => restored.begin()).toThrow("existing request");
  });
  it("keeps accepted request when later approval/execute fails", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    a.submitting(address);
    a.accepted(address);
    a.finish();
    expect(r.saved()).toEqual({ proposal: address, outcome: "submitted" });
    expect(() => r.begin()).toThrow("existing request");
  });
  it("clears recovery only after confirmed workflow completion", () => {
    const s = storage(),
      r = new SendRecovery("wallet-a", s);
    const a = r.begin();
    a.submitting(address);
    a.accepted(address);
    a.complete();
    a.finish();
    expect(new SendRecovery("wallet-a", s).saved()).toBeNull();
    expect(() => r.begin()).not.toThrow();
  });
  it("switching account/network stops late actions and retains the original request", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    a.submitting(address);
    r.scope("wallet-b");
    expect(() => a.accepted(address)).toThrow("changed");
    expect(r.saved()).toBeNull();
    a.finish();
    r.scope("wallet-a");
    expect(r.saved()).toEqual({ proposal: address, outcome: "submitted" });
    expect(() => r.begin()).toThrow("existing request");
  });
  it("will not treat a late old-account completion as the new account's success", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    a.submitting(address);
    r.scope("wallet-b");
    expect(() => a.complete()).toThrow("changed");
    expect(r.saved("wallet-a")).not.toBeNull();
  });
  it("retains recovery in memory if browser storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
      removeItem: () => {
        throw Error();
      },
    };
    const r = new SendRecovery("wallet-a", broken);
    const a = r.begin();
    a.submitting(address);
    a.finish();
    expect(r.saved()?.outcome).toBe("unknown");
  });
  it("permits a deliberately separate request only after explicit recovery action", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    a.submitting(address);
    expect(() => r.startSeparateRequest()).toThrow("Wait");
    a.finish();
    r.startSeparateRequest();
    expect(() => r.begin()).not.toThrow();
  });
  it("finished attempts cannot submit again", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    a.finish();
    expect(() => a.submitting(address)).toThrow("stopped");
  });
  it("switching away and back does not revive an old wallet popup", () => {
    const r = new SendRecovery("wallet-a");
    const a = r.begin();
    r.scope("wallet-b");
    r.scope("wallet-a");
    expect(() => a.submitting(address)).toThrow("changed");
    a.finish();
    expect(() => r.begin()).not.toThrow();
  });
});
