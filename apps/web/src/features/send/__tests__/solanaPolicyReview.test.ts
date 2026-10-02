import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { captureSolanaPolicyReview } from "../infrastructure/solanaPolicyReview";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/policies/persistentWalletPolicy", () => ({ currentWalletPolicyCommitment: read }));
const connection = {} as Connection;
const wallet = PublicKey.default;
let target: EventTarget;
let values: Map<string, string>;
beforeEach(() => {
  values = new Map(); target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, { localStorage: { getItem: (key: string) => values.get(key) ?? null } }));
  read.mockReset().mockResolvedValue("00");
});
afterEach(() => vi.unstubAllGlobals());
it("detects local policy edits even if no event was delivered", async () => {
  const guard = await captureSolanaPolicyReview(connection, wallet);
  values.set("clear.policies.v1", "changed");
  await expect(guard.assertCurrent()).rejects.toThrow("Wallet protection changed");
  guard.dispose();
});
it("does not revive an accepted review after a cross-tab policy ABA", async () => {
  const guard = await captureSolanaPolicyReview(connection, wallet);
  target.dispatchEvent(Object.assign(new Event("storage"), { key: "clear.policies.v1" }));
  await expect(guard.assertCurrent()).rejects.toThrow("Wallet protection changed");
  guard.dispose();
});
it.each(["clear:policies-changed", "clear:spending-budget-changed", "clear:personal-policy-changed"])("invalidates synchronously on %s", async (event) => {
  const guard = await captureSolanaPolicyReview(connection, wallet);
  target.dispatchEvent(new Event(event));
  await expect(guard.assertCurrent()).rejects.toThrow("Wallet protection changed");
  guard.dispose();
});
it("ignores unrelated cross-tab storage and permits unchanged policy", async () => {
  const guard = await captureSolanaPolicyReview(connection, wallet);
  target.dispatchEvent(Object.assign(new Event("storage"), { key: "theme" }));
  await expect(guard.assertCurrent()).resolves.toBeUndefined();
  guard.dispose();
});
it("fails closed on inaccessible storage", async () => {
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("Storage unavailable"); } });
  await expect(captureSolanaPolicyReview(connection, wallet)).rejects.toThrow("Storage unavailable");
});
