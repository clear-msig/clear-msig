"use client";

// Build a CSV blob of multisig activity for accountants / DAO
// treasurers. The on-chain side already exposes everything we need
// (proposal status, who proposed, approvals collected, when), so this
// is a pure transform — no extra RPC. Chain-side tx ids land via the
// localStorage txLog when the send was initiated from this device.
//
// Why CSV: every accounting tool ingests it. JSON would be cleaner
// for engineering use, but the audience here is whoever does
// quarterly bookkeeping for the DAO/treasury — same shape as a bank
// statement.
//
// Quoting model: minimal RFC-4180 — wrap a field in double quotes if
// it contains comma, newline, or double-quote, and double-up
// internal double-quotes. UTF-8 with BOM so Excel doesn't mojibake
// non-ASCII names.

import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import type { TxAttempt } from "@/lib/retail/txLog";
import { friendlyStatus, friendlyIntentLabel } from "@/lib/retail/labels";

export interface ActivityCsvOptions {
  /// Optional global wallet name. When set, every output row uses
  /// this name in the Wallet column AND the attempt-join filters
  /// to attempts on this wallet. When omitted, each row uses its
  /// own r.walletName — required for the cross-wallet export
  /// (rows can come from any wallet the user belongs to).
  walletName?: string;
  rows: RecentActivityRow[];
  /// Optional per-attempt log (localStorage). When the proposalPda
  /// can be inferred from a recorded send, the matching tx id +
  /// explorer URL get joined onto the proposal's CSV row. Today we
  /// don't store proposalPda in TxAttempt, so the join is by
  /// (walletName, recipientShort, amount) — best effort, but lets
  /// the resulting CSV carry tx ids the user already has.
  attempts?: TxAttempt[];
  /// Per-approver count map (proposal PDA → approval count). Today
  /// the activity row carries the bitmap; if you'd rather render
  /// "1/2", supply a precomputed map. Optional.
  approvalsByProposal?: Map<string, { collected: number; total: number }>;
}

/// Header row order — keep stable so users with saved templates in
/// Excel/Sheets don't have to remap columns when we add fields.
const HEADER = [
  "Date (UTC)",
  "Wallet",
  "Type",
  "Status",
  "Approvals",
  "Proposal",
  "Tx hash",
  "Recipient",
  "Amount",
  "Ticker",
];

// Match window: how close (ms) a successful txAttempt's timestamp
// has to be to a proposal's proposedAt to count as "the same event"
// for join purposes. 30 minutes is loose enough to absorb normal
// propose→execute latency + clock skew, tight enough that two
// unrelated sends to the same wallet won't collide.
const ATTEMPT_JOIN_WINDOW_MS = 30 * 60 * 1000;

export function buildActivityCsv(opts: ActivityCsvOptions): string {
  const { walletName, rows, attempts = [], approvalsByProposal } = opts;

  // Per-wallet attempt index. Used for the time-proximity join
  // below — bucketing by wallet up-front saves filtering for
  // every row in the cross-wallet path.
  const attemptsByWallet = new Map<string, TxAttempt[]>();
  for (const a of attempts) {
    if (a.status !== "success") continue;
    const list = attemptsByWallet.get(a.walletName) ?? [];
    list.push(a);
    attemptsByWallet.set(a.walletName, list);
  }
  for (const list of attemptsByWallet.values()) {
    list.sort((a, b) => a.ts - b.ts);
  }

  const lines: string[] = [HEADER.join(",")];
  for (const r of rows) {
    const dateUtc = formatUtc(r.proposedAt);
    const status = friendlyStatus(r.status, r.intentTemplate);
    const approvals = approvalsByProposal?.get(r.proposalPda);
    const approvalsStr = approvals
      ? `${approvals.collected}/${approvals.total}`
      : `${countBits(r.approvalBitmap)}`;
    const type = friendlyIntentLabel(r.intentTemplate);

    // Time-proximity attempt match. proposedAt is on-chain seconds;
    // attempt ts is browser ms. Convert + check window. Use the
    // per-row wallet to scope attempts so a cross-wallet export
    // doesn't pull a Wallet-A attempt against a Wallet-B proposal.
    const proposedMs = Number(r.proposedAt) * 1000;
    let bestMatch: TxAttempt | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    const candidates = attemptsByWallet.get(r.walletName) ?? [];
    for (const a of candidates) {
      const delta = Math.abs(a.ts - proposedMs);
      if (delta < bestDelta && delta <= ATTEMPT_JOIN_WINDOW_MS) {
        bestDelta = delta;
        bestMatch = a;
      }
    }

    const recipient = bestMatch?.recipientShort ?? "";
    const amount = bestMatch?.amountDisplay ?? "";
    const ticker = bestMatch?.ticker ?? "";
    const txHash = bestMatch?.txId ?? "";

    // Per-row wallet name when no global one was passed (the
    // cross-wallet export path); otherwise the legacy single-wallet
    // value. Same column position either way.
    const walletForRow = walletName ?? r.walletName;

    lines.push(
      [
        dateUtc,
        walletForRow,
        type,
        status,
        approvalsStr,
        r.proposalPda,
        txHash,
        recipient,
        amount,
        ticker,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  // BOM + CRLF — Excel's preferred dialect.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/// Trigger a browser download of the CSV. Uses an object URL +
/// auto-clicked anchor so we don't need a dedicated UI surface.
export function downloadActivityCsv(
  filename: string,
  csv: string,
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke a tick so browsers that need the URL alive
  // during the download have it.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ── helpers ──────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatUtc(epochSeconds: bigint): string {
  if (epochSeconds === 0n) return "";
  const d = new Date(Number(epochSeconds) * 1000);
  if (!Number.isFinite(d.getTime())) return "";
  // YYYY-MM-DD HH:MM:SS UTC — accountant-friendly, sortable as text.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

function countBits(n: number): number {
  let c = 0;
  let v = n >>> 0;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}
