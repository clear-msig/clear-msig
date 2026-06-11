import { describe, expect, it } from "vitest";
import {
  productWorkspaceHomeHref,
  productWorkspaceRedirectHref,
  walletProductSurface,
} from "@/lib/productWorkspace";

describe("product workspace routing", () => {
  it("sends agent vaults to Agent Trading as their home", () => {
    expect(productWorkspaceHomeHref("Agent vault#abc123", "agent")).toBe(
      "/app/wallet/Agent%20vault%23abc123/agents",
    );
  });

  it("redirects agent vaults away from generic treasury pages", () => {
    const walletName = "Agent vault#abc123";

    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: "/app/wallet/Agent%20vault%23abc123",
      }),
    ).toBe("/app/wallet/Agent%20vault%23abc123/agents");
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: "/app/wallet/Agent%20vault%23abc123/policy",
      }),
    ).toBe("/app/wallet/Agent%20vault%23abc123/agents/policy");
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: "/app/wallet/Agent%20vault%23abc123/agents/hyperliquid",
      }),
    ).toBeNull();
  });

  it("keeps personal wallets out of pro and agent controls", () => {
    const walletName = "Family#abc123";

    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "personal",
        pathname: "/app/wallet/Family%23abc123/agents",
      }),
    ).toBe("/app/wallet/Family%23abc123");
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "personal",
        pathname: "/app/wallet/Family%23abc123/policy",
      }),
    ).toBe("/app/wallet/Family%23abc123");
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "personal",
        pathname: "/app/wallet/Family%23abc123/send/eth",
      }),
    ).toBeNull();
  });

  it("only treats live app products as wallet product surfaces", () => {
    expect(walletProductSurface("agent")).toBe("agent");
    expect(walletProductSurface("payments")).toBeNull();
    expect(walletProductSurface("p2pdefi")).toBeNull();
  });
});
