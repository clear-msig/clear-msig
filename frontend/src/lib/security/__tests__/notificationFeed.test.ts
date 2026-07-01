import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listNotificationFeed,
  recordNotificationFeed,
} from "@/lib/security/notificationFeed";

function installStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };

  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: vi.fn(),
  });
}

describe("notification feed", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
  });

  it("stores money movement receipts", () => {
    recordNotificationFeed("user-1", {
      kind: "money_movement",
      walletName: "Family",
      title: "Crypto bought",
      body: "Family received the crypto from your bank checkout.",
      href: "/app/wallet/Family",
    });

    expect(listNotificationFeed("user-1")).toEqual([
      expect.objectContaining({
        kind: "money_movement",
        walletName: "Family",
        title: "Crypto bought",
      }),
    ]);
  });
});
