"use client";

const STORAGE_KEY = "clear.approval-reminders.v1";
export const DEFAULT_REMINDER_INTERVAL_MS = 15 * 60 * 1000;

export interface ApprovalReminderPrefs {
  enabled: boolean;
  intervalMs: number;
  lastReminderAt?: number;
}

export function loadApprovalReminderPrefs(): ApprovalReminderPrefs {
  const fallback: ApprovalReminderPrefs = {
    enabled: true,
    intervalMs: DEFAULT_REMINDER_INTERVAL_MS,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : fallback.enabled,
      intervalMs:
        typeof parsed.intervalMs === "number" && parsed.intervalMs > 0
          ? parsed.intervalMs
          : fallback.intervalMs,
      lastReminderAt:
        typeof parsed.lastReminderAt === "number"
          ? parsed.lastReminderAt
          : undefined,
    };
  } catch {
    return fallback;
  }
}

export function saveApprovalReminderPrefs(
  prefs: ApprovalReminderPrefs,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new Event("clear:approval-reminders-changed"));
  } catch {
    /* local preference only */
  }
}

export function shouldSendApprovalReminder(
  prefs: ApprovalReminderPrefs,
  now = Date.now(),
): boolean {
  if (!prefs.enabled) return false;
  if (typeof prefs.lastReminderAt !== "number") return true;
  return now - prefs.lastReminderAt >= prefs.intervalMs;
}
