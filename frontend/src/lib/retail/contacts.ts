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

import { PublicKey } from "@solana/web3.js";

export interface Contact {
  id: string;
  name: string;
  /// Base58 Solana address.
  address: string;
  /// Unix ms.
  createdAt: number;
}

const STORAGE_KEY = "clear.contacts.v1";

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
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Contact =>
        c &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.address === "string" &&
        typeof c.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function persist(contacts: Contact[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch {
    /* localStorage full or blocked — silently noop */
  }
}

export function saveContact(input: { name: string; address: string }): Contact {
  const trimmedName = input.name.trim();
  const trimmedAddress = input.address.trim();
  if (!trimmedName) throw new Error("Contact name is required");
  if (!isValidSolanaAddress(trimmedAddress)) {
    throw new Error("That doesn't look like a valid wallet address");
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
    createdAt: Date.now(),
  };
  if (existing >= 0) {
    list[existing] = { ...list[existing], name: trimmedName };
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
