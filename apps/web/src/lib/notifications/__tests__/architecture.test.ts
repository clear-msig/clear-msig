import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("notification architecture", () => {
  it("keeps feed and read state off local storage", () => {
    const hook = source("lib/hooks/useNotificationFeed.ts");
    const runtime = source("lib/hooks/useActionNotifications.ts");
    expect(hook).not.toContain("localStorage");
    expect(runtime).not.toContain("clear.notif-seen");
    expect(runtime).toContain("syncNotificationEvents");
  });

  it("authenticates API reads and writes before server persistence", () => {
    const route = source("app/api/notifications/route.ts");
    expect(route).toContain("authenticateNotificationRequest(request)");
    expect(route).toContain("listServerNotifications(userId)");
    expect(route).toContain("ingestServerNotifications(userId, entries)");
  });

  it("uses the Dynamic access token without persisting it", () => {
    const client = source("lib/notifications/client.ts");
    const walletRuntime = source(
      "features/wallet-runtime/infrastructure/DynamicWalletRuntimeProvider.tsx",
    );
    const auth = source("lib/notifications/dynamicAuth.ts");
    expect(client).toContain("getNotificationAuthToken()");
    expect(walletRuntime).toContain("configureNotificationTokenGetter(getAuthToken)");
    expect(source("lib/hooks/useNotificationFeed.ts")).toContain(
      "getNotificationSessionKey()",
    );
    expect(auth).toContain('header.alg !== "RS256"');
    expect(auth).toContain("requiresAdditionalAuth(payload)");
    expect(auth).not.toMatch(/console\.(log|warn|error).*token/i);
  });
});
