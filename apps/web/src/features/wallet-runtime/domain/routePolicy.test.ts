import { describe, expect, it } from "vitest";
import { needsWalletRuntime } from "@/features/wallet-runtime/domain/routePolicy";

describe("wallet runtime route policy", () => {
  it("loads wallet capability on product routes", () => {
    expect(needsWalletRuntime("/app/wallet/Family")).toBe(true);
    expect(needsWalletRuntime("/send/eth")).toBe(true);
  });

  it("keeps public and onboarding routes free of the eager wallet SDK", () => {
    expect(needsWalletRuntime("/")).toBe(false);
    expect(needsWalletRuntime("/connect")).toBe(false);
    expect(needsWalletRuntime("/privacy")).toBe(false);
    expect(needsWalletRuntime("/security")).toBe(false);
  });
});
