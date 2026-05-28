"use client";

export const DEFAULT_SIGNING_EXPIRY_SECONDS = 30 * 60;

export function freshSigningExpiry(
  nowMs = Date.now(),
  windowSeconds = DEFAULT_SIGNING_EXPIRY_SECONDS,
): string {
  const expiresAt = new Date(nowMs + windowSeconds * 1000);
  return [
    expiresAt.getUTCFullYear().toString().padStart(4, "0"),
    (expiresAt.getUTCMonth() + 1).toString().padStart(2, "0"),
    expiresAt.getUTCDate().toString().padStart(2, "0"),
  ].join("-") + " " + [
    expiresAt.getUTCHours().toString().padStart(2, "0"),
    expiresAt.getUTCMinutes().toString().padStart(2, "0"),
    expiresAt.getUTCSeconds().toString().padStart(2, "0"),
  ].join(":");
}

export function withFreshExpiry<T extends object>(
  input: T & { expiry?: string },
): T & { expiry: string } {
  return { ...input, expiry: input.expiry ?? freshSigningExpiry() };
}
