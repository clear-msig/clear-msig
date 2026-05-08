"use client";

// Webhook notifications. A second feed of events for treasury
// teams that already pipe ops signal into Slack / Discord /
// PagerDuty / Zapier / their own ingester.
//
// Three events:
//   - pending_approval : a new proposal landed and the connected
//                        user is one of its approvers. Same trigger
//                        as the browser Notification + email.
//   - send_executed    : a send tx broadcast successfully. Fired
//                        from txLog.recordAttempt.
//   - send_failed      : a send tx hit a CLI / chain error. Fired
//                        from txLog.recordAttempt.
//
// Transport: direct browser POST. Slack/Discord/Zapier/Make/n8n
// incoming-webhook URLs all advertise permissive CORS, so we don't
// need a server-side relay (and skipping the relay removes an SSRF
// surface — see docs in this file). If the user's destination
// rejects with a CORS error, they pick a permissive provider or
// point at their own proxy. Settings copy says so.
//
// Signature: each POST carries an `X-Clear-Signature: sha256=<hex>`
// header. The receiver re-computes HMAC-SHA256 over the raw body
// using the shared secret to verify the request came from this
// browser's pref store. Replay protection: the body includes a
// `timestamp_ms` field — receivers should reject anything older
// than ~5 minutes.
//
// Storage: per-device localStorage. The secret is stored in plain
// text — same threat model as the rest of the app, where the
// signing keypair lives in the wallet and Clear's local prefs are
// considered low-value.

const STORAGE_KEY = "clear.webhook-notifications.v1";

export type WebhookEventType =
  | "pending_approval"
  | "send_executed"
  | "send_failed";

export const ALL_EVENT_TYPES: WebhookEventType[] = [
  "pending_approval",
  "send_executed",
  "send_failed",
];

export interface WebhookPrefs {
  enabled: boolean;
  /// Destination URL. Empty when not configured. Must be http(s).
  url: string;
  /// Shared secret for HMAC. Empty allowed (no signature header)
  /// but a saved value gets included.
  secret: string;
  /// Subset of event types the user wants. Empty = nothing fires
  /// (effectively the same as enabled=false but lets the user keep
  /// the URL while pausing).
  events: WebhookEventType[];
  /// Subset of wallet names. Empty = every wallet.
  walletScope: string[];
}

export function emptyWebhookPrefs(): WebhookPrefs {
  return {
    enabled: false,
    url: "",
    secret: "",
    events: [...ALL_EVENT_TYPES],
    walletScope: [],
  };
}

export function loadWebhookPrefs(): WebhookPrefs {
  const empty = emptyWebhookPrefs();
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.enabled === "boolean" &&
      typeof parsed.url === "string" &&
      typeof parsed.secret === "string" &&
      Array.isArray(parsed.events) &&
      Array.isArray(parsed.walletScope)
    ) {
      const events = parsed.events.filter((e: unknown): e is WebhookEventType =>
        ALL_EVENT_TYPES.includes(e as WebhookEventType),
      );
      return {
        enabled: parsed.enabled,
        url: parsed.url,
        secret: parsed.secret,
        events,
        walletScope: parsed.walletScope.filter(
          (s: unknown): s is string => typeof s === "string",
        ),
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

export function saveWebhookPrefs(prefs: WebhookPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private-mode — silently noop */
  }
}

export function isValidWebhookUrl(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

interface WebhookPayload {
  event: WebhookEventType;
  timestamp_ms: number;
  wallet_name: string;
  /// Friendly label rendered in the UI. Receivers can ignore.
  intent_label?: string;
  /// Approvals so far / approver count snapshot.
  approvals_collected?: number;
  approver_count?: number;
  /// Direct deep-link to the proposal page.
  proposal_url?: string;
  /// Send-specific fields when applicable.
  amount_display?: string;
  ticker?: string;
  recipient?: string;
  tx_id?: string;
  explorer_url?: string;
  error_brief?: string;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return "";
  }
  try {
    const enc = new TextEncoder();
    const key = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await window.crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(body),
    );
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

/// Fire a webhook for one event. Returns true on 2xx, false on
/// any failure (network / CORS / non-2xx). Never throws.
///
/// Caller is responsible for upstream filtering (event-type opt-in,
/// wallet-scope match) — this function unconditionally posts when
/// called.
export async function fireWebhook(
  payload: WebhookPayload,
): Promise<boolean> {
  const prefs = loadWebhookPrefs();
  if (!prefs.enabled) return false;
  if (!isValidWebhookUrl(prefs.url)) return false;

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Avoid a CORS preflight for vanilla Slack/Discord webhooks
    // when no signature is set. Custom headers trigger preflight,
    // and a fair number of incoming-webhook endpoints don't return
    // CORS headers on OPTIONS even though they accept POST.
  };
  if (prefs.secret) {
    const sig = await hmacSha256Hex(prefs.secret, body);
    if (sig) {
      headers["X-Clear-Signature"] = `sha256=${sig}`;
    }
  }

  try {
    const res = await fetch(prefs.url, {
      method: "POST",
      headers,
      body,
      // mode:"cors" is the default; we surface the failure rather
      // than slipping into no-cors (which would hide non-2xx).
      mode: "cors",
      credentials: "omit",
      // Bound the wait. A slow webhook shouldn't hang the UI thread.
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/// Convenience for callers that always want to gate on a wallet
/// name + event type. Returns true when the prefs say "fire this".
export function shouldFireWebhook(
  prefs: WebhookPrefs,
  event: WebhookEventType,
  walletName: string,
): boolean {
  if (!prefs.enabled) return false;
  if (!isValidWebhookUrl(prefs.url)) return false;
  if (!prefs.events.includes(event)) return false;
  if (
    prefs.walletScope.length > 0 &&
    !prefs.walletScope.includes(walletName)
  ) {
    return false;
  }
  return true;
}

export function eventTypeLabel(event: WebhookEventType): string {
  switch (event) {
    case "pending_approval":
      return "New approval needed";
    case "send_executed":
      return "Send succeeded";
    case "send_failed":
      return "Send failed";
  }
}

/// Send a probe payload to the configured destination so the user
/// can verify their endpoint accepts our format. Returns true on
/// 2xx. Used by the "Test" button in Settings.
export async function fireTestWebhook(): Promise<boolean> {
  const prefs = loadWebhookPrefs();
  if (!isValidWebhookUrl(prefs.url)) return false;
  // Bypass `enabled` gate — the test fires even when paused so the
  // user can validate without flipping the switch.
  const body = JSON.stringify({
    event: "test" as const,
    timestamp_ms: Date.now(),
    wallet_name: "Clear test",
    intent_label: "If you can read this, your webhook works.",
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (prefs.secret) {
    const sig = await hmacSha256Hex(prefs.secret, body);
    if (sig) headers["X-Clear-Signature"] = `sha256=${sig}`;
  }
  try {
    const res = await fetch(prefs.url, {
      method: "POST",
      headers,
      body,
      mode: "cors",
      credentials: "omit",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
