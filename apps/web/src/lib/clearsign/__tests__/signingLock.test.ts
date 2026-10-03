import { expect, it } from "vitest";
import { withSigningLock } from "../signingLock";
it("excludes a second request for the whole wallet handoff and releases after failure", async () => {
  let release!: () => void;
  const pending = withSigningLock(() => new Promise<void>(resolve => { release = resolve; }));
  await expect(withSigningLock(async () => 2)).rejects.toThrow("current signing request");
  release(); await pending;
  await expect(withSigningLock(async () => { throw new Error("Wallet rejected"); })).rejects.toThrow("Wallet rejected");
  await expect(withSigningLock(async () => 3)).resolves.toBe(3);
});
