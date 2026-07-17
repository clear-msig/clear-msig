import { describe, expect, it } from "vitest";
import { initialAuthFlowDecision } from "@/features/wallet-runtime/domain/initialAuthFlow";

describe("initial Dynamic auth flow", () => {
  it("dismisses a stale post-login flow once wallet hydration completes", () => {
    expect(
      initialAuthFlowDecision({
        sdkHasLoaded: true,
        hasUsableWallet: true,
        alreadyHandled: false,
        showAuthFlow: true,
      }),
    ).toEqual({ handled: true, dismiss: true });
  });

  it("never dismisses later signature or passkey flows", () => {
    expect(
      initialAuthFlowDecision({
        sdkHasLoaded: true,
        hasUsableWallet: true,
        alreadyHandled: true,
        showAuthFlow: true,
      }),
    ).toEqual({ handled: true, dismiss: false });
  });
});
