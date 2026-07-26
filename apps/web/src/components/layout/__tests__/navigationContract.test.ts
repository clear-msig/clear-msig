import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAV_ITEMS,
  isPrimaryNavActive,
} from "@/components/layout/primaryNav";
import {
  isWalletNavActive,
  walletSubNav,
} from "@/components/layout/walletScopedNav";

describe("stable navigation contract", () => {
  it("uses the same four global destinations at every viewport", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Home",
      "Activity",
      "People",
      "Settings",
    ]);
  });

  it("treats account as part of Settings", () => {
    const settings = PRIMARY_NAV_ITEMS.find((item) => item.id === "settings");
    expect(settings).toBeDefined();
    expect(isPrimaryNavActive("/app/account", settings!)).toBe(true);
    expect(isPrimaryNavActive("/app/account/security", settings!)).toBe(true);
  });

  it("assigns every app-level route to one primary destination", () => {
    const cases = [
      "/app/wallet",
      "/app/wallet/new",
      "/app/proposals/abc",
      "/app/intents",
      "/app/invitations",
      "/app/notifications/abc",
      "/app/activity",
      "/app/contacts",
      "/app/settings",
      "/app/account",
      "/app/secure/new",
      "/app/security-architecture",
    ];

    for (const pathname of cases) {
      const active = PRIMARY_NAV_ITEMS.filter((item) =>
        isPrimaryNavActive(pathname, item),
      );
      expect(active, pathname).toHaveLength(1);
    }
  });

  it("uses one wallet navigation model", () => {
    expect(walletSubNav().map((item) => item.label)).toEqual([
      "Overview",
      "Activity",
      "People",
      "Rules",
    ]);
  });

  it("assigns every wallet route to one active section", () => {
    const base = "/app/wallet/Family%23abc123";
    const cases = [
      [`${base}`, ""],
      [`${base}/send/btc`, ""],
      [`${base}/agents/library`, ""],
      [`${base}/activity`, "activity"],
      [`${base}/members/add`, "members"],
      [`${base}/policy`, "policy"],
      [`${base}/policies/new`, "policy"],
      [`${base}/budget`, "policy"],
      [`${base}/settings`, "policy"],
    ] as const;

    for (const [pathname, expected] of cases) {
      const active = walletSubNav()
        .filter((item) => isWalletNavActive(pathname, base, item.sub))
        .map((item) => item.sub);
      expect(active).toEqual([expected]);
    }
  });
});
