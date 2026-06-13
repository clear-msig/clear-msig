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

  it("keeps the full Agent product flow inside Agent Trading", () => {
    const walletName = "Agent vault#abc123";
    const base = "/app/wallet/Agent%20vault%23abc123";

    expect(productWorkspaceHomeHref(walletName, "agent")).toBe(`${base}/agents`);
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: base,
      }),
    ).toBe(`${base}/agents`);
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: `${base}/agents/start`,
      }),
    ).toBeNull();
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: `${base}/agents/trades`,
      }),
    ).toBeNull();
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "agent",
        pathname: `${base}/members`,
      }),
    ).toBe(`${base}/agents`);
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
    ).toBeNull();
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "personal",
        pathname: "/app/wallet/Family%23abc123/policies",
      }),
    ).toBe("/app/wallet/Family%23abc123");
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "personal",
        pathname: "/app/wallet/Family%23abc123/budget",
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

  it("keeps pro treasuries out of agent trading controls", () => {
    const walletName = "Ops treasury#abc123";

    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "pro",
        pathname: "/app/wallet/Ops%20treasury%23abc123/agents",
      }),
    ).toBe("/app/wallet/Ops%20treasury%23abc123");
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "pro",
        pathname: "/app/wallet/Ops%20treasury%23abc123/policy",
      }),
    ).toBeNull();
    expect(
      productWorkspaceRedirectHref({
        walletName,
        surface: "pro",
        pathname: "/app/wallet/Ops%20treasury%23abc123/rules",
      }),
    ).toBe("/app/wallet/Ops%20treasury%23abc123/policy");
  });

  it("only treats live app products as wallet product surfaces", () => {
    expect(walletProductSurface("agent")).toBe("agent");
    expect(walletProductSurface("payments")).toBeNull();
    expect(walletProductSurface("p2pdefi")).toBeNull();
  });
});
