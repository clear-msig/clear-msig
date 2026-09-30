import { getNotificationAuthToken } from "@/lib/notifications/sessionToken";

export function emailSessionHeaders(): Record<string, string> {
  const token = getNotificationAuthToken();
  if (!token) throw new Error("Sign in with Dynamic before sending email. A connected wallet alone is not an authenticated session.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
