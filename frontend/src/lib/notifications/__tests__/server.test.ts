import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ingestServerNotifications,
  listServerNotifications,
  markAllServerNotificationsSeen,
  markServerNotificationSeen,
  resetNotificationMemoryForTests,
} from "@/lib/notifications/server";

describe("server notification feed", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    resetNotificationMemoryForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("deduplicates stable source events for a user", async () => {
    const event = {
      sourceId: "proposal:abc:approval-needed",
      kind: "pending_approval" as const,
      walletName: "Family",
      title: "Family needs your approval",
      body: "Send 0.1 BTC",
    };

    const first = await ingestServerNotifications("user-1", [event]);
    const second = await ingestServerNotifications("user-1", [event]);

    expect(first[0]?.inserted).toBe(true);
    expect(second[0]?.inserted).toBe(false);
    expect(second[0]?.entry.id).toBe(first[0]?.entry.id);
    expect(await listServerNotifications("user-1")).toHaveLength(1);
    expect(await listServerNotifications("user-2")).toHaveLength(0);
  });

  it("persists one and all read receipts", async () => {
    const results = await ingestServerNotifications("user-1", [
      {
        sourceId: "event-1",
        kind: "wallet_request",
        walletName: "Team",
        title: "New request",
        body: "A request arrived.",
      },
      {
        sourceId: "event-2",
        kind: "membership_change",
        walletName: "Team",
        title: "Access updated",
        body: "Your role changed.",
      },
    ]);

    await markServerNotificationSeen("user-1", results[0]!.entry.id);
    let rows = await listServerNotifications("user-1");
    expect(rows.filter((entry) => entry.seenAt)).toHaveLength(1);

    await markAllServerNotificationsSeen("user-1");
    rows = await listServerNotifications("user-1");
    expect(rows.every((entry) => typeof entry.seenAt === "number")).toBe(true);
  });

  it("retains only the newest bounded history", async () => {
    await ingestServerNotifications(
      "user-1",
      Array.from({ length: 205 }, (_, index) => ({
        sourceId: `event-${index}`,
        kind: "wallet_request" as const,
        walletName: "Team",
        title: `Request ${index}`,
        body: "A request arrived.",
        createdAt: Date.now() + index,
      })),
    );
    const rows = await listServerNotifications("user-1");
    expect(rows).toHaveLength(200);
    expect(rows[0]?.title).toBe("Request 204");
  });

  it("fails closed without durable storage in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(listServerNotifications("user-1")).rejects.toThrow(
      "requires Redis in production",
    );
  });
});
