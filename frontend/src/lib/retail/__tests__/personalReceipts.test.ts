import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listPersonalReceipts,
  recordPersonalReceipt,
} from "@/lib/retail/personalReceipts";

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

describe("personal receipts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00Z"));
  });

  it("records readable wallet receipts", () => {
    const receipt = recordPersonalReceipt("Family", {
      title: "You paused sends.",
      body: "New sends are blocked until you resume from Protection.",
    });

    expect(receipt?.title).toBe("You paused sends.");
    expect(listPersonalReceipts("Family")).toEqual([
      expect.objectContaining({
        walletName: "Family",
        title: "You paused sends.",
        body: "New sends are blocked until you resume from Protection.",
      }),
    ]);
  });

  it("keeps receipts separated per wallet", () => {
    recordPersonalReceipt("Family", {
      title: "Rent added.",
      body: "Rent now appears as a spending category.",
    });
    recordPersonalReceipt("Roommates", {
      title: "Bills added.",
      body: "Bills now appears as a spending category.",
    });

    expect(listPersonalReceipts("Family")).toHaveLength(1);
    expect(listPersonalReceipts("Roommates")[0]?.title).toBe("Bills added.");
  });
});
