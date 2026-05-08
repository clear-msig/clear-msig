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
  encryptPolicyBatch,
  type EncryptedPayload,
  type FheType,
} from "@/lib/encrypt/client";
import type {
  RecipientCondition,
  RuleCondition,
} from "@/lib/policies/types";

const enc = new TextEncoder();

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

/// Walk the conditions a draft rule carries and replace any
/// recipient-condition's plaintext addresses with their encrypted
/// equivalents. Other condition shapes pass through; their values
/// are tiny (numbers, hours, days) and round-tripping them through
/// FHE today is overhead without payoff. When real on-chain FHE
/// lands the amount + time conditions get encrypted too — that's a
/// one-spot extension here.
export async function encryptConditions(
  raw: RuleCondition[],
): Promise<RuleCondition[]> {
  const out: RuleCondition[] = [];
  for (const c of raw) {
    if (c.kind === "recipient") {
      const recipient = c as RecipientCondition;
      const plaintext = recipient.addresses ?? [];
      const encrypted = await encryptRecipientAddresses(plaintext);
      out.push({
        kind: "recipient",
        mode: recipient.mode,
        encryptedAddresses: encrypted,
        // Drop the plaintext array on persisted rules so a
        // localStorage dump doesn't carry the raw recipient list
        // even on devices where the user has overridden the lock.
        addresses: undefined,
      });
    } else {
      out.push(c);
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
  const { decryptPolicy } = await import("@/lib/encrypt/client");
  const dec = new TextDecoder();
  const out: RuleCondition[] = [];
  for (const c of saved) {
    if (c.kind === "recipient") {
      const recipient = c as RecipientCondition;
      const enc = recipient.encryptedAddresses ?? [];
      const plaintext: string[] = [];
      for (const p of enc) {
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
        addresses: plaintext,
        encryptedAddresses: enc,
      });
    } else {
      out.push(c);
    }
  }
  return out;
}
