"use client";

import { getNotificationAuthToken } from "@/lib/notifications/sessionToken";

/** Read the current bearer for each request; never use a local session subject as proof. */
export function agentSessionHeaders(): Record<string, string> {
  const token = getNotificationAuthToken();
  if (!token) throw new Error("Sign in with Dynamic to access private agent data. A connected wallet alone is not an authenticated session.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
