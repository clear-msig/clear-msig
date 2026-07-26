"use client";

let tokenGetter: () => string | undefined = () => undefined;

export function configureNotificationTokenGetter(
  getter: () => string | undefined,
): void {
  tokenGetter = getter;
}

export function getNotificationAuthToken(): string | undefined {
  return tokenGetter();
}

export function getNotificationSessionKey(): string {
  const token = tokenGetter();
  if (!token) return "signed-out";
  try {
    const payload = token.split(".")[1] ?? "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(window.atob(padded)) as { sub?: unknown };
    return typeof decoded.sub === "string" && decoded.sub ? decoded.sub : "unknown-user";
  } catch {
    return "invalid-session";
  }
}
