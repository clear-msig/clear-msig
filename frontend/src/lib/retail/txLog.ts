"use client";

// Tiny per-wallet log of send attempts (success + failure), backed
// by localStorage. The product had only ephemeral toast feedback
// for failed sends - once the toast disappeared, there was no
// record of "did my send actually go through? what failed?".
// Modern wallets keep an in-app history of attempts with
// click-through to the explorer (success) or the structured error
// (failure); this is the same pattern, scoped to the per-browser-
// per-wallet view (no server side).
//
// What's stored:
//   - id              - random uuid for React keying + dedup.
//   - walletName      - the on-chain wallet name (carries the
//                       creator suffix). Used to filter.
//   - chainKind       - `chain_kind` byte from the intent / send.
//   - status          - "success" | "failed".
//   - amountDisplay?  - pre-formatted amount string for UI.
//   - ticker?         - chain ticker (SOL / ETH / …).
//   - recipientShort? - abbreviated recipient for display.
//   - txId?           - chain-native tx hash on success.
//   - explorerUrl?    - pre-built explorer link on success.
//   - errorBrief?     - short user-facing failure copy on failure.
//   - errorStderr?    - raw CLI stderr (truncated) on failure, for
//                       debug / "Show details".
//   - ts              - Date.now() at record-time.
//
// Cap: 100 entries total across all wallets. FIFO drop. Plenty for
// retail use and won't bloat localStorage.

const STORAGE_KEY = "clear.txlog.v1";
const MAX_ENTRIES = 100;

export type TxAttemptStatus = "success" | "failed";

export interface TxAttempt {
  id: string;
  walletName: string;
  chainKind: number;
  status: TxAttemptStatus;
  amountDisplay?: string;
  ticker?: string;
  recipientShort?: string;
  /// Full recipient address. Optional only because pre-v1.1 entries
  /// don't have it; new entries should always set it so the recents
  /// chip strip on the send pages can pre-fill the input.
  recipientFull?: string;
  txId?: string;
  explorerUrl?: string;
  errorBrief?: string;
  errorStderr?: string;
  ts: number;
}

function readAll(): TxAttempt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTxAttempt);
  } catch {
    return [];
  }
}

function writeAll(rows: TxAttempt[]): void {
  if (typeof window === "undefined") return;
  try {
    // FIFO drop: keep the most-recent MAX_ENTRIES.
    const trimmed = rows.slice(-MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    // Notify same-tab consumers - `storage` only fires on OTHER tabs.
    window.dispatchEvent(new Event("clear:txlog-changed"));
  } catch {
    /* quota / private mode - silently drop */
  }
}

function isTxAttempt(x: unknown): x is TxAttempt {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.walletName === "string" &&
    typeof r.chainKind === "number" &&
    (r.status === "success" || r.status === "failed") &&
    typeof r.ts === "number"
  );
}

/// Record a new tx attempt. Generates the id + timestamp.
export function recordAttempt(
  attempt: Omit<TxAttempt, "id" | "ts">,
): TxAttempt {
  const full: TxAttempt = {
    ...attempt,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    ts: Date.now(),
  };
  const all = readAll();
  all.push(full);
  writeAll(all);
  // Best-effort webhook fan-out for treasury ops tooling. Imported
  // lazily to avoid pulling the full webhook module into surfaces
  // that only read txLog. fireWebhook respects opt-in + scope; this
  // call site is the unconditional fan-out point.
  void fireSendWebhook(full);
  return full;
}

async function fireSendWebhook(attempt: TxAttempt): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const mod = await import("@/lib/security/webhookNotifications");
    const prefs = mod.loadWebhookPrefs();
    const event = attempt.status === "success" ? "send_executed" : "send_failed";
    if (!mod.shouldFireWebhook(prefs, event, attempt.walletName)) return;
    await mod.fireWebhook({
      event,
      timestamp_ms: attempt.ts,
      wallet_name: attempt.walletName,
      amount_display: attempt.amountDisplay,
      ticker: attempt.ticker,
      recipient: attempt.recipientFull ?? attempt.recipientShort,
      tx_id: attempt.txId,
      explorer_url: attempt.explorerUrl,
      error_brief: attempt.errorBrief,
    });
  } catch {
    /* webhook fire is best-effort - never propagate */
  }
}

/// List attempts for a single wallet, newest first. Pass a limit
/// to cap (e.g. dashboard widget shows 5; the full history page
/// would pass undefined).
export function listAttempts(walletName: string, limit?: number): TxAttempt[] {
  const all = readAll();
  const filtered = all.filter((a) => a.walletName === walletName);
  filtered.sort((a, b) => b.ts - a.ts);
  return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

/// Distinct most-recent recipients for a wallet+chain. Drives the
/// quick-pick chip strip above the recipient input on the EVM send
/// pages. We dedupe by full address (case-insensitive for EVM) so
/// repeated sends to the same place don't waste chip slots, and
/// only return entries that recorded the full address - pre-v1.1
/// rows lack `recipientFull` and we can't pre-fill the input from
/// a truncated display. Caller decides the limit.
export function recentRecipients(
  walletName: string,
  chainKind: number,
  limit: number = 4,
): { address: string; ticker: string; ts: number }[] {
  const all = readAll()
    .filter(
      (a) =>
        a.walletName === walletName &&
        a.chainKind === chainKind &&
        a.status === "success" &&
        typeof a.recipientFull === "string" &&
        a.recipientFull.length > 0,
    )
    .sort((x, y) => y.ts - x.ts);
  const seen = new Set<string>();
  const out: { address: string; ticker: string; ts: number }[] = [];
  for (const a of all) {
    const addr = a.recipientFull!;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: addr, ticker: a.ticker ?? "", ts: a.ts });
    if (out.length >= limit) break;
  }
  return out;
}

/// Clear every attempt for a single wallet. Used when the user
/// dismisses or resets - not exposed in the UI yet but kept for
/// completeness.
export function clearWallet(walletName: string): void {
  const all = readAll();
  const next = all.filter((a) => a.walletName !== walletName);
  writeAll(next);
}

/// Subscribe to changes - fires on this tab (via the
/// "clear:txlog-changed" event we dispatch above) AND other tabs
/// (via the native `storage` event). Returns the unsubscribe.
export function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener("clear:txlog-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("clear:txlog-changed", handler);
    window.removeEventListener("storage", handler);
  };
}
