import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REMINDER_INTERVAL_MS,
  loadApprovalReminderPrefs,
  saveApprovalReminderPrefs,
  shouldSendApprovalReminder,
} from "@/lib/security/approvalReminders";

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

describe("approval reminders", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
  });

  it("defaults reminders on", () => {
    expect(loadApprovalReminderPrefs()).toEqual({
      enabled: true,
      intervalMs: DEFAULT_REMINDER_INTERVAL_MS,
    });
  });

  it("stores the user's reminder preference", () => {
    saveApprovalReminderPrefs({
      enabled: false,
      intervalMs: 60_000,
      lastReminderAt: 123,
    });

    expect(loadApprovalReminderPrefs()).toEqual({
      enabled: false,
      intervalMs: 60_000,
      lastReminderAt: 123,
    });
  });

  it("waits for the interval before nudging again", () => {
    expect(
      shouldSendApprovalReminder(
        { enabled: true, intervalMs: 1_000, lastReminderAt: 5_000 },
        5_500,
      ),
    ).toBe(false);
    expect(
      shouldSendApprovalReminder(
        { enabled: true, intervalMs: 1_000, lastReminderAt: 5_000 },
        6_000,
      ),
    ).toBe(true);
  });
});
