"use client";

// Bridge between policy-rule plaintext input and the existing
// Encrypt scaffolding. Wraps `encryptPolicyBatch` with policy-
// specific helpers so the form code in /policies/new doesn't have
// to reach into the FHE typing system.
//
// The design contract: condition VALUES (the addresses in an
// allowlist, the bytes of an amount cap, the hours in a time
// window) round-trip through encryptPolicyBatch and end up as
// `EncryptedPayload[]` on the persisted rule. Metadata (action
// kind, condition shape) stays plaintext so the UI can render
// the rule without an async decrypt.
//
// What this module does NOT do:
//   - Send anything over the wire. Today's local stub keeps
//     ciphertext IDs in localStorage so the call surface matches
//     what the live Encrypt SDK will use.
//   - Verify the ciphertexts on chain. That requires Encrypt's
//     #[encrypt_fn] handlers in the clear-wallet program.

import {
  decryptPolicy,
  encryptPolicy,
  encryptPolicyBatch,
  type EncryptedPayload,
  type FheType,
} from "@/lib/encrypt/client";
import type {
  AmountCondition,
  AssetCondition,
  RecipientCondition,
  RuleCondition,
  TimeWindowCondition,
  VelocityCondition,
} from "@/lib/policies/types";

const enc = new TextEncoder();
const dec = new TextDecoder();

function textBytes(value: string | number | null | undefined): Uint8Array {
  return enc.encode(value == null ? "" : String(value));
}

function jsonBytes(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function bytesText(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

async function decryptText(payload: EncryptedPayload | undefined): Promise<string | null> {
  if (!payload) return null;
  const bytes = await decryptPolicy(payload);
  return bytesText(bytes);
}

async function decryptJson<T>(
  payload: EncryptedPayload | undefined,
): Promise<T | null> {
  const text = await decryptText(payload);
  if (text == null || text.length === 0) return null;
  return JSON.parse(text) as T;
}

/// Encrypt a list of recipient addresses. Returns `EncryptedPayload[]`
/// with one entry per address, in the same order.
export async function encryptRecipientAddresses(
  addresses: string[],
): Promise<EncryptedPayload[]> {
  const trimmed = addresses
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (trimmed.length === 0) return [];
  return encryptPolicyBatch(
    trimmed.map((a) => ({
      plaintext: enc.encode(a),
      fheType: "ebytes" as FheType,
    })),
  );
}

/// Encrypt a list of pubkey-shaped strings (additional approvers
/// for the require-extra-approvers action). Same shape as recipient
/// addresses today; kept as a separate helper so the swap to
/// real-FHE per-field semantics is one place per use case.
export async function encryptApprovers(
  approvers: string[],
): Promise<EncryptedPayload[]> {
  const trimmed = approvers
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (trimmed.length === 0) return [];
  return encryptPolicyBatch(
    trimmed.map((a) => ({
      plaintext: enc.encode(a),
      fheType: "ebytes" as FheType,
    })),
  );
}

/// Walk the conditions a draft rule carries and replace every
/// policy value with its encrypted equivalent. The condition `kind`
/// and list/action shape stay plaintext so the UI can render a rule
/// shell; concrete values are decrypted only in memory for editing
/// and evaluation.
export async function encryptConditions(
  raw: RuleCondition[],
): Promise<RuleCondition[]> {
  const out: RuleCondition[] = [];
  for (const c of raw) {
    switch (c.kind) {
      case "asset": {
        const asset = c as AssetCondition;
        const encrypted = await encryptPolicyBatch([
          { plaintext: textBytes(asset.chainKind), fheType: "euint8" },
          { plaintext: textBytes(asset.tokenContract ?? ""), fheType: "ebytes" },
        ]);
        out.push({
          kind: "asset",
          chainKind: null,
          encryptedChainKind: encrypted[0],
          tokenContract: undefined,
          encryptedTokenContract: encrypted[1],
        });
        break;
      }
      case "recipient": {
        const recipient = c as RecipientCondition;
        const plaintext = recipient.addresses ?? [];
        const encrypted = await encryptRecipientAddresses(plaintext);
        out.push({
          kind: "recipient",
          mode: recipient.mode,
          encryptedAddresses: encrypted,
          addresses: undefined,
        });
        break;
      }
      case "amount": {
        const amount = c as AmountCondition;
        const encrypted = await encryptPolicyBatch([
          { plaintext: textBytes(amount.minDisplay ?? ""), fheType: "ebytes" },
          { plaintext: textBytes(amount.maxDisplay ?? ""), fheType: "ebytes" },
          { plaintext: textBytes(amount.ticker ?? ""), fheType: "ebytes" },
        ]);
        out.push({
          kind: "amount",
          minDisplay: undefined,
          encryptedMinDisplay: encrypted[0],
          maxDisplay: undefined,
          encryptedMaxDisplay: encrypted[1],
          ticker: undefined,
          encryptedTicker: encrypted[2],
        });
        break;
      }
      case "time-window": {
        const window = c as TimeWindowCondition;
        const encrypted = await encryptPolicyBatch([
          { plaintext: textBytes(window.startHour), fheType: "euint8" },
          { plaintext: textBytes(window.endHour), fheType: "euint8" },
          { plaintext: jsonBytes(window.daysOfWeek), fheType: "ebytes" },
          { plaintext: textBytes(window.match), fheType: "ebytes" },
        ]);
        out.push({
          kind: "time-window",
          startHour: 0,
          encryptedStartHour: encrypted[0],
          endHour: 0,
          encryptedEndHour: encrypted[1],
          daysOfWeek: [],
          encryptedDaysOfWeek: encrypted[2],
          match: "inside",
          encryptedMatch: encrypted[3],
        });
        break;
      }
      case "velocity": {
        const velocity = c as VelocityCondition;
        const encrypted = await encryptPolicyBatch([
          { plaintext: textBytes(velocity.capDisplay), fheType: "ebytes" },
          { plaintext: textBytes(velocity.ticker), fheType: "ebytes" },
          { plaintext: textBytes(velocity.windowDays), fheType: "euint8" },
        ]);
        out.push({
          kind: "velocity",
          capDisplay: "",
          encryptedCapDisplay: encrypted[0],
          ticker: "",
          encryptedTicker: encrypted[1],
          windowDays: 1,
          encryptedWindowDays: encrypted[2],
        });
        break;
      }
    }
  }
  return out;
}

/// Inverse of encryptConditions. Decrypts the recipient-list
/// addresses for the in-memory edit form so the user can see what
/// they previously saved. Other conditions pass through.
export async function decryptConditions(
  saved: RuleCondition[],
): Promise<RuleCondition[]> {
  const out: RuleCondition[] = [];
  for (const c of saved) {
    switch (c.kind) {
      case "asset": {
        const asset = c as AssetCondition;
        const chainText = await decryptText(asset.encryptedChainKind);
        const tokenText = await decryptText(asset.encryptedTokenContract);
        const chainKind =
          chainText == null || chainText.length === 0
            ? asset.chainKind ?? null
            : parseNullableNumber(chainText);
        out.push({
          ...asset,
          chainKind,
          tokenContract:
            tokenText == null || tokenText.length === 0
              ? asset.tokenContract ?? null
              : tokenText,
        });
        break;
      }
      case "recipient": {
        const recipient = c as RecipientCondition;
        const encrypted = recipient.encryptedAddresses ?? [];
        const plaintext: string[] = [];
        for (const p of encrypted) {
          try {
            const bytes = await decryptPolicy(p);
            plaintext.push(dec.decode(bytes));
          } catch {
            /* skip unreadable entries */
          }
        }
        out.push({
          kind: "recipient",
          mode: recipient.mode,
          addresses: plaintext.length > 0 ? plaintext : recipient.addresses,
          encryptedAddresses: encrypted,
        });
        break;
      }
      case "amount": {
        const amount = c as AmountCondition;
        const min = await decryptText(amount.encryptedMinDisplay);
        const max = await decryptText(amount.encryptedMaxDisplay);
        const ticker = await decryptText(amount.encryptedTicker);
        out.push({
          ...amount,
          minDisplay: min == null || min.length === 0 ? amount.minDisplay ?? null : min,
          maxDisplay: max == null || max.length === 0 ? amount.maxDisplay ?? null : max,
          ticker: ticker == null || ticker.length === 0 ? amount.ticker ?? null : ticker,
        });
        break;
      }
      case "time-window": {
        const window = c as TimeWindowCondition;
        const start = await decryptText(window.encryptedStartHour);
        const end = await decryptText(window.encryptedEndHour);
        const days = await decryptJson<number[]>(window.encryptedDaysOfWeek);
        const match = await decryptText(window.encryptedMatch);
        out.push({
          ...window,
          startHour: parseHour(start, window.startHour),
          endHour: parseHour(end, window.endHour),
          daysOfWeek: days ?? window.daysOfWeek,
          match:
            match === "inside" || match === "outside"
              ? match
              : window.match,
        });
        break;
      }
      case "velocity": {
        const velocity = c as VelocityCondition;
        const cap = await decryptText(velocity.encryptedCapDisplay);
        const ticker = await decryptText(velocity.encryptedTicker);
        const window = await decryptText(velocity.encryptedWindowDays);
        out.push({
          ...velocity,
          capDisplay: cap == null || cap.length === 0 ? velocity.capDisplay : cap,
          ticker: ticker == null || ticker.length === 0 ? velocity.ticker : ticker,
          windowDays: parseWindowDays(window, velocity.windowDays),
        });
        break;
      }
    }
  }
  return out;
}

export async function encryptCooldownSeconds(
  seconds: number,
): Promise<EncryptedPayload> {
  return encryptPolicy(textBytes(Math.max(0, seconds)), { fheType: "euint32" });
}

export async function decryptCooldownSeconds(
  payload: EncryptedPayload | undefined,
  fallback: number | undefined,
): Promise<number | undefined> {
  const text = await decryptText(payload);
  if (text == null || text.length === 0) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function parseNullableNumber(text: string): number | null {
  if (text.length === 0) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHour(text: string | null, fallback: number): number {
  if (text == null || text.length === 0) return fallback;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(23, Math.max(0, parsed));
}

function parseWindowDays(
  text: string | null,
  fallback: 1 | 7 | 30,
): 1 | 7 | 30 {
  if (text === "7") return 7;
  if (text === "30") return 30;
  if (text === "1") return 1;
  return fallback;
}
