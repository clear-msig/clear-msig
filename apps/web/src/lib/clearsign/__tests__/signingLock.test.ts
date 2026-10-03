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

it.each(["resolve", "reject"] as const)("keeps the provider lock after timeout until late %s", async (outcome) => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  let handoffs = 0;
  const provider = new Promise<string>((ok, fail) => { resolve = ok; reject = fail; });
  const { trackProviderSigning } = await import("../signingLock");
  const { withWalletSignatureTimeout } = await import("@/lib/wallet/signing");
  const first = withSigningLock(() => {
    handoffs += 1;
    return withWalletSignatureTimeout(trackProviderSigning(provider), 5);
  });
  await expect(first).rejects.toThrow("Wallet did not respond");
  await expect(withSigningLock(async () => { handoffs += 1; })).rejects.toThrow("current signing request");
  expect(handoffs).toBe(1);
  if (outcome === "resolve") resolve("late signature"); else reject(new Error("late rejection"));
  await new Promise(resolve => setTimeout(resolve, 0));
  await expect(first).rejects.toThrow("Wallet did not respond");
  await expect(withSigningLock(async () => { handoffs += 1; return "fresh"; })).resolves.toBe("fresh");
  expect(handoffs).toBe(2);
});
