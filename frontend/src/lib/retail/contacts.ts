// Contacts — local-first name → address book.
//
// Stored in localStorage, keyed per device. No server sync yet —
// when contacts go on-chain (or sync via the backend), swap the
// implementation behind this module without touching consumers.
//
// Why a name → address map at all: the retail rules say "no raw
// addresses on screen by default." Contacts are how we translate the
// thing the user thinks ("send to Sarah") into the thing the program
// needs ("destination: 8xKqRVKvw…"). When the user pastes an address
// they don't have a contact for, we surface it with an explicit
// warning rather than silently disguising it.
//
// Integrity: each entry carries an HMAC-SHA256 over its load-bearing
// fields, keyed by a per-device secret. On load, mismatched entries
// are dropped (and exposed via lastIntegrityReport for the UI to
// warn). This raises the bar against:
//   - DevTools edits that swap a single address
//   - Browser-extension key-by-key tampering
//   - Cross-device clipboard imports of a forged JSON
// It does NOT defeat XSS — same-origin JS reads both the key and the
// entries. See SECURITY.md surface C for the model.

import { PublicKey } from "@solana/web3.js";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils";

export interface Contact {
  id: string;
  name: string;
  /// Base58 Solana address.
  address: string;
  /// Optional email — stored alongside the name/address so the
  /// add-friend flow can later trigger a "you've been invited" email
  /// when a backend email service is wired. Validated lightly on save.
  email?: string;
  /// Unix ms.
  createdAt: number;
}

interface StoredContact extends Contact {
  /// Hex HMAC-SHA256(deviceKey, "id|name|address|email|createdAt").
  /// Optional only for backward compatibility: pre-integrity entries
  /// are accepted on first load and re-signed via persist().
  sig?: string;
}

const STORAGE_KEY = "clear.contacts.v1";
const INTEGRITY_KEY = "clear.contacts.integritykey.v1";

interface IntegrityReport {
  tamperedIds: string[];
  unsignedIds: string[];
}

let lastIntegrityReport: IntegrityReport = { tamperedIds: [], unsignedIds: [] };

export function getIntegrityReport(): IntegrityReport {
  return { ...lastIntegrityReport };
}

function loadOrCreateDeviceKey(): Uint8Array {
  if (typeof window === "undefined") return new Uint8Array(0);
  try {
    const existing = window.localStorage.getItem(INTEGRITY_KEY);
    if (existing && /^[0-9a-f]{64}$/i.test(existing)) {
      return hexToBytes(existing);
    }
    const fresh = randomBytes(32);
    window.localStorage.setItem(INTEGRITY_KEY, bytesToHex(fresh));
    return fresh;
  } catch {
    // localStorage blocked — fall back to a transient key. Integrity
    // protection is reduced to the lifetime of this script execution
    // but the rest of the API still works.
    return randomBytes(32);
  }
}

function signContact(c: Contact, key: Uint8Array): string {
  const payload = `${c.id}|${c.name}|${c.address}|${c.email ?? ""}|${c.createdAt}`;
  return bytesToHex(hmac(sha256, key, utf8ToBytes(payload)));
}

function verifyContact(c: StoredContact, key: Uint8Array): boolean {
  if (!c.sig) return false;
  const expected = signContact(c, key);
  // Constant-time compare via @noble's hex roundtrip is overkill for
  // a localStorage check, but cheap.
  if (expected.length !== c.sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ c.sig.charCodeAt(i);
  }
  return diff === 0;
}

export function isValidSolanaAddress(s: string): boolean {
  if (!s || s.length < 32 || s.length > 44) return false;
  try {
    new PublicKey(s.trim());
    return true;
  } catch {
    return false;
  }
}

export function loadContacts(): Contact[] {
  if (typeof window === "undefined") return [];
  const tampered: string[] = [];
  const unsigned: string[] = [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      lastIntegrityReport = { tamperedIds: [], unsignedIds: [] };
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      lastIntegrityReport = { tamperedIds: [], unsignedIds: [] };
      return [];
    }
    const key = loadOrCreateDeviceKey();
    const wellShaped = parsed.filter(
      (c): c is StoredContact =>
        c &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.address === "string" &&
        typeof c.createdAt === "number" &&
        (c.email === undefined || typeof c.email === "string") &&
        (c.sig === undefined || typeof c.sig === "string"),
    );
    const accepted: Contact[] = [];
    let needsRewrite = false;
    for (const stored of wellShaped) {
      if (stored.sig) {
        if (verifyContact(stored, key)) {
          const { sig: _drop, ...clean } = stored;
          void _drop;
          accepted.push(clean);
        } else {
          tampered.push(stored.id);
          if (typeof console !== "undefined") {
            console.warn(
              `[contacts] integrity check failed for ${stored.id}; dropping entry`,
            );
          }
        }
      } else {
        // Pre-integrity entry. Trust on first load + re-sign on next
        // persist so the next read enforces.
        unsigned.push(stored.id);
        const { sig: _drop, ...clean } = stored;
        void _drop;
        accepted.push(clean);
        needsRewrite = true;
      }
    }
    lastIntegrityReport = { tamperedIds: tampered, unsignedIds: unsigned };
    if (needsRewrite || tampered.length > 0) {
      persist(accepted);
    }
    return accepted;
  } catch {
    lastIntegrityReport = { tamperedIds: [], unsignedIds: [] };
    return [];
  }
}

function persist(contacts: Contact[]): void {
  if (typeof window === "undefined") return;
  try {
    const key = loadOrCreateDeviceKey();
    const signed: StoredContact[] = contacts.map((c) => ({
      ...c,
      sig: signContact(c, key),
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(signed));
  } catch {
    /* localStorage full or blocked — silently noop */
  }
}

/// Light email validation — enough to catch typos before a friend
/// fills the field with "n/a" or similar. Real email-deliverability
/// checks happen on the backend when the email service is wired.
export function isValidEmail(s: string): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function saveContact(input: {
  name: string;
  address: string;
  email?: string;
}): Contact {
  const trimmedName = input.name.trim();
  const trimmedAddress = input.address.trim();
  const trimmedEmail = input.email?.trim();
  if (!trimmedName) throw new Error("Contact name is required");
  if (!isValidSolanaAddress(trimmedAddress)) {
    throw new Error("That doesn't look like a valid wallet address");
  }
  if (trimmedEmail && !isValidEmail(trimmedEmail)) {
    throw new Error("That email looks malformed");
  }
  const list = loadContacts();
  // Replace if same address already exists (latest write wins).
  const existing = list.findIndex((c) => c.address === trimmedAddress);
  const contact: Contact = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: trimmedName,
    address: trimmedAddress,
    email: trimmedEmail || undefined,
    createdAt: Date.now(),
  };
  if (existing >= 0) {
    list[existing] = {
      ...list[existing],
      name: trimmedName,
      email: trimmedEmail || list[existing].email,
    };
    persist(list);
    return list[existing];
  }
  list.push(contact);
  persist(list);
  return contact;
}

export function removeContact(id: string): void {
  persist(loadContacts().filter((c) => c.id !== id));
}

export function findByName(query: string): Contact | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return loadContacts().find((c) => c.name.toLowerCase() === q);
}

export function recentContacts(limit = 4): Contact[] {
  return [...loadContacts()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/// Display the address as `4chars…4chars` so it fits in tight UI
/// without revealing the full thing in passing glances.
export function shortAddress(address: string): string {
  if (!address) return "";
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
