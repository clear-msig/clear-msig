"use client";

// Ethereum Name Service (ENS) resolution — `vitalik.eth` → 0x….
//
// Symmetric to lib/chain/sns.ts but for EVM. Modern EVM wallets
// resolve ENS names in the recipient field so users can send to
// `vitalik.eth` instead of pasting a 0x address. ENS lives on
// Ethereum mainnet; the resolved address is universal across all
// EVM chains, so it's still useful when the destination chain is
// Sepolia.
//
// Doing the full ENS lookup (namehash → registry → resolver →
// addr()) needs keccak256 + an EVM RPC client. We don't ship
// either — instead we hit the long-standing `api.ensideas.com`
// public proxy that wraps the on-chain lookup and returns a JSON
// `{address, name, displayName, avatar}` payload. Same approach
// Coinbase Wallet / Rainbow have used for years.
//
// Endpoint: https://api.ensideas.com/ens/resolve/<name>
//   - Accepts "vitalik" or "vitalik.eth".
//   - 200 with {"address":"0x...","name":"vitalik.eth",...} on hit.
//   - 200 with {"address":null} on miss (not registered).
//
// Returns null on miss / network error / non-".eth"-shaped input
// so callers can fall back to "type the address" UX without an
// error toast on every keystroke.

const ENS_PROXY = "https://api.ensideas.com/ens/resolve";

const HEX_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/// Heuristic: does this look like a name we should attempt to
/// resolve? Skip if it's already a 0x address, accept anything
/// containing a dot, and accept bare lowercase labels (3–32 chars,
/// alphanumeric plus hyphens — the ENS character set is broader
/// but this is the safe subset).
export function looksLikeEnsName(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  if (HEX_ADDR_RE.test(trimmed)) return false;
  if (trimmed.includes(".")) return true;
  return /^[a-z0-9-]{3,32}$/.test(trimmed.toLowerCase());
}

/// Resolve an ENS name to a 0x address. Returns the lowercased
/// address on hit, null on miss or any failure. Never throws.
export async function resolveEnsName(input: string): Promise<string | null> {
  const trimmed = input.trim().toLowerCase();
  if (!looksLikeEnsName(trimmed)) return null;
  // Default to `.eth` if the user typed a bare label.
  const name = trimmed.includes(".") ? trimmed : `${trimmed}.eth`;
  try {
    const res = await fetch(`${ENS_PROXY}/${encodeURIComponent(name)}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { address?: string | null };
    if (typeof json.address !== "string" || !json.address) return null;
    if (!HEX_ADDR_RE.test(json.address)) return null;
    return json.address;
  } catch {
    return null;
  }
}
