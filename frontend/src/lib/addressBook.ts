"use client";

// Tiny address book backed by localStorage. Treasury teams reuse the
// same recipient set repeatedly (cap-table wallets, vendor wallets, dev
// fund vault); typing 44-char base58 every time is the kind of friction
// that makes the multisig story feel toy-grade.
//
// Entirely client-local for v1. No backend, no sync. Server-side
// address books would need per-user auth which we don't have yet.

import { useCallback, useEffect, useState } from "react";

export interface AddressBookEntry {
  /// Friendly label (e.g. "Vendor — payroll", "Dev fund").
  label: string;
  /// Solana base58 address. Other-chain addresses (EVM hex, BTC bech32)
  /// are out of scope for v1 — clear-msig's params are mostly Solana
  /// recipients today.
  address: string;
  /// `Date.now()` at insert. Lets us sort by recency without depending
  /// on insertion order surviving JSON round-trips.
  createdAt: number;
}

const STORAGE_KEY = "clear-msig.addressBook.v1";

function loadFromStorage(): AddressBookEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is AddressBookEntry =>
        e &&
        typeof e === "object" &&
        typeof (e as { label?: unknown }).label === "string" &&
        typeof (e as { address?: unknown }).address === "string"
    );
  } catch {
    return [];
  }
}

function saveToStorage(entries: AddressBookEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* full / blocked — silent noop */
  }
}

export function useAddressBook() {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEntries(loadFromStorage());
    setHydrated(true);
  }, []);

  const add = useCallback((label: string, address: string) => {
    const trimmedLabel = label.trim();
    const trimmedAddress = address.trim();
    if (!trimmedLabel || !trimmedAddress) return;
    setEntries((prev) => {
      // Dedupe by address — last write wins on label.
      const filtered = prev.filter((e) => e.address !== trimmedAddress);
      const next = [
        ...filtered,
        { label: trimmedLabel, address: trimmedAddress, createdAt: Date.now() },
      ];
      saveToStorage(next);
      return next;
    });
  }, []);

  const remove = useCallback((address: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.address !== address);
      saveToStorage(next);
      return next;
    });
  }, []);

  return { entries, hydrated, add, remove };
}

/// Look up the friendly label for an address, if it exists. Used to
/// render `you · vendor — payroll` style chips next to addresses
/// rather than just the truncated base58. Returns the address shortened
/// when no label is found.
export function labelForAddress(
  address: string,
  entries: AddressBookEntry[]
): string {
  const trimmed = address.trim();
  const hit = entries.find((e) => e.address === trimmed);
  if (hit) return hit.label;
  if (trimmed.length > 14) return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
  return trimmed;
}
