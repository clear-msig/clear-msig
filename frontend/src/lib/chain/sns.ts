"use client";

// Solana Name Service (SNS) resolution — `name.sol` → wallet address.
//
// Modern wallets resolve human-readable names in the recipient
// field so users don't have to copy-paste base58. SNS is the
// dominant Solana naming standard (run by Bonfida). They expose
// a free Cloudflare-Workers proxy that wraps the on-chain lookup
// so we don't need to add the @bonfida/spl-name-service dep.
//
// Endpoint: https://sns-sdk-proxy.bonfida.workers.dev/resolve/<name>
//   - Accepts "bonfida" or "bonfida.sol" — strips the suffix.
//   - 200 with {"s":"ok","result":"<base58>"} on a hit.
//   - 200 with {"s":"err","error":"..."} on miss / not registered.
//
// Returns null on miss / network error / non-".sol"-looking input
// so callers can gracefully fall back to "type-the-address" UX
// without surfacing an error toast on every keystroke.

const SNS_PROXY = "https://sns-sdk-proxy.bonfida.workers.dev/resolve";

/// Heuristic: does this look like a name we should attempt to
/// resolve? We accept "name.sol" and "name" forms, but skip if
/// it's already a base58-shaped address (≥32 chars, base58
/// charset) — sending that to the proxy would be wasted work.
export function looksLikeSnsName(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  // Already a base58 pubkey? Skip.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return false;
  // Contains a dot? Treat as a name regardless of suffix.
  if (trimmed.includes(".")) return true;
  // Bare label — must be 3-32 chars, lowercase alphanumeric (the
  // SNS character set is broader, but this is the safe subset).
  return /^[a-z0-9_-]{3,32}$/.test(trimmed.toLowerCase());
}

/// Resolve a `.sol` (or bare-label) name to a base58 address.
/// Returns null on miss, network error, or any non-resolvable
/// input. Never throws — calling code uses the result + a separate
/// loading flag to render UX.
export async function resolveSnsName(input: string): Promise<string | null> {
  const trimmed = input.trim().toLowerCase();
  if (!looksLikeSnsName(trimmed)) return null;
  // Strip ".sol" suffix; the proxy accepts both forms but the
  // route is cleaner with the bare label.
  const label = trimmed.endsWith(".sol")
    ? trimmed.slice(0, -4)
    : trimmed;
  if (label.length === 0) return null;
  try {
    const res = await fetch(`${SNS_PROXY}/${encodeURIComponent(label)}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      s?: string;
      result?: string;
      error?: string;
    };
    if (json.s === "ok" && typeof json.result === "string" && json.result) {
      return json.result;
    }
    return null;
  } catch {
    return null;
  }
}
