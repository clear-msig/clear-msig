"use client";

export const DEFAULT_SIGNING_EXPIRY_SECONDS = 30 * 60;

export function freshSigningExpiry(
  nowMs = Date.now(),
  windowSeconds = DEFAULT_SIGNING_EXPIRY_SECONDS,
): string {
  return formatCliExpiry(new Date(nowMs + windowSeconds * 1000));
}

export function formatUnixSigningExpiry(unixSeconds: number | bigint | string): string {
  const value =
    typeof unixSeconds === "bigint"
      ? Number(unixSeconds)
      : typeof unixSeconds === "number"
        ? unixSeconds
        : Number(unixSeconds.trim());
  if (!Number.isFinite(value)) {
    throw new Error("Expiry must be a Unix timestamp in seconds.");
  }
  return formatCliExpiry(new Date(value * 1000));
}

export function normalizeSigningExpiry(expiry: string | undefined): string {
  if (!expiry) return freshSigningExpiry();
  const trimmed = expiry.trim();
  if (/^\d+$/.test(trimmed)) return formatUnixSigningExpiry(trimmed);
  return trimmed;
}

function formatCliExpiry(expiresAt: Date): string {
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Expiry timestamp is outside the supported date range.");
  }
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
  return { ...input, expiry: normalizeSigningExpiry(input.expiry) };
}
