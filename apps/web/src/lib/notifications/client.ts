"use client";

import { getNotificationAuthToken } from "@/lib/notifications/sessionToken";
import type {
  NotificationEventInput,
  NotificationFeedEntry,
  NotificationIngestResult,
} from "@/lib/notifications/types";

const CHANGE_EVENT = "clear:server-notifications-changed";

export class NotificationClientError extends Error {
  constructor(message: string, readonly code: "signed_out" | "request_failed") {
    super(message);
  }
}

export async function fetchNotificationFeed(
  signal?: AbortSignal,
): Promise<NotificationFeedEntry[]> {
  const body = await notificationRequest<{ entries?: NotificationFeedEntry[] }>(
    { method: "GET", signal },
  );
  return Array.isArray(body.entries) ? body.entries : [];
}

export async function syncNotificationEvents(
  entries: NotificationEventInput[],
): Promise<NotificationIngestResult[]> {
  if (entries.length === 0) return [];
  const body = await notificationRequest<{ results?: NotificationIngestResult[] }>({
    method: "POST",
    body: JSON.stringify({ action: "ingest", entries }),
  });
  notifyChanged();
  return Array.isArray(body.results) ? body.results : [];
}

export async function markServerNotificationRead(id: string): Promise<void> {
  await notificationRequest({
    method: "POST",
    body: JSON.stringify({ action: "mark_seen", id }),
  });
  notifyChanged();
}

export async function markAllServerNotificationsRead(): Promise<void> {
  await notificationRequest({
    method: "POST",
    body: JSON.stringify({ action: "mark_all_seen" }),
  });
  notifyChanged();
}

export function subscribeToNotificationChanges(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

async function notificationRequest<T = Record<string, unknown>>(
  init: RequestInit,
): Promise<T> {
  const token = getNotificationAuthToken();
  if (!token) {
    throw new NotificationClientError("Sign in to sync notifications.", "signed_out");
  }
  const response = await fetch("/api/notifications", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new NotificationClientError(
      body.error || "Notification sync failed.",
      response.status === 401 ? "signed_out" : "request_failed",
    );
  }
  return body;
}

function notifyChanged(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
