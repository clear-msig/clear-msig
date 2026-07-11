import { describe, expect, it } from "vitest";
import { needsWalletRuntime } from "@/features/wallet-runtime/domain/routePolicy";

describe("wallet runtime route policy", () => {
  it("loads wallet capability on product and connection routes", () => {
    expect(needsWalletRuntime("/connect")).toBe(true);
    expect(needsWalletRuntime("/app/wallet/Family")).toBe(true);
    expect(needsWalletRuntime("/send/eth")).toBe(true);
  });

  it("keeps public information routes free of the wallet SDK", () => {
    expect(needsWalletRuntime("/")).toBe(false);
    expect(needsWalletRuntime("/privacy")).toBe(false);
    expect(needsWalletRuntime("/security")).toBe(false);
  });
});
