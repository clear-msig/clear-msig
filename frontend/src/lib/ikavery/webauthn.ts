"use client";

export type WebauthnAvailability =
  | { ok: true }
  | { ok: false; reason: "insecure" | "unavailable" };

export interface WebauthnEnv {
  isSecureContext?: boolean;
  hasCredentialsGet?: boolean;
}

export function detectWebauthnAvailability(
  env?: WebauthnEnv,
): WebauthnAvailability {
  const insecure =
    typeof env?.isSecureContext === "boolean" && !env.isSecureContext;
  if (insecure) return { ok: false, reason: "insecure" };
  const hasApi =
    typeof env?.hasCredentialsGet === "boolean"
      ? env.hasCredentialsGet
      : typeof navigator !== "undefined" &&
        !!navigator.credentials &&
        typeof navigator.credentials.get === "function";
  return hasApi ? { ok: true } : { ok: false, reason: "unavailable" };
}
