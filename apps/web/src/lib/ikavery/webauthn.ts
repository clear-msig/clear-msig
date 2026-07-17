"use client";

export type WebauthnAvailability =
  | { ok: true }
  | { ok: false; reason: "insecure" | "unavailable" };

export interface WebauthnEnv {
  isSecureContext?: boolean;
  hasCredentialsCreate?: boolean;
  hasCredentialsGet?: boolean;
}

export function detectWebauthnAvailability(
  env?: WebauthnEnv,
): WebauthnAvailability {
  const insecure =
    typeof env?.isSecureContext === "boolean" && !env.isSecureContext;
  if (insecure) return { ok: false, reason: "insecure" };
  const hasApi =
    typeof env?.hasCredentialsCreate === "boolean" ||
    typeof env?.hasCredentialsGet === "boolean"
      ? (env.hasCredentialsCreate ?? true) && (env.hasCredentialsGet ?? true)
      : typeof globalThis.navigator !== "undefined" &&
        !!globalThis.navigator.credentials &&
        typeof globalThis.navigator.credentials.create === "function" &&
        typeof globalThis.navigator.credentials.get === "function";
  return hasApi ? { ok: true } : { ok: false, reason: "unavailable" };
}
