"use client";

// Canonical-domain check. Phishing copies are easy to make
// pixel-perfect; the only reliable tell is the URL itself. The
// /security page tells users "bookmark this", but that's passive.
// This guard runs in-app and surfaces a banner when the host
// doesn't match an allowlist of known-good domains. It's not a
// hard block (false-positives on a legit alternate domain would
// be worse than off), but it's a visible tripwire that an attacker
// would have to either spoof the URL bar or get added to.
//
// Allowlist sources:
//   1. Hard-coded `CANONICAL_HOSTS` (the known prod / staging
//      domains we ship from this repo).
//   2. NEXT_PUBLIC_ALLOWED_HOSTS — comma-separated CSV from env,
//      so a custom-domain deploy doesn't have to fork the repo.
//   3. Localhost / 127.0.0.1 always pass (dev convenience).
//
// What this is NOT: a TLS / HSTS check, a certificate-transparency
// monitor, or a "did you reach this domain via a known-good link"
// referrer check. It only catches the case where the user is
// already on a domain we don't recognise. The strongest defense
// remains the bookmark + sign-payload-substitution protection
// already in useSignWithWallet.

/// Hard-coded canonical hosts — the prod app + the demo app.
/// `clearsig.xyz` is the canonical domain (added 2026-05-08).
/// `clear-msig.vercel.app` stays on the list as the Vercel preview /
/// fallback URL so old shareable links keep passing the phishing check.
const CANONICAL_HOSTS: readonly string[] = [
  "clearsig.xyz",
  "www.clearsig.xyz",
  "clear-msig.vercel.app",
];

/// Hosts that should always pass: dev + IP loopback variants.
const ALWAYS_TRUSTED: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "[::1]",
];

function envAllowed(): string[] {
  const raw = process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function normaliseHost(host: string): string {
  // Strip port for the comparison — `localhost:3000` and
  // `localhost:3001` should both pass the dev exception.
  return host.toLowerCase().split(":")[0];
}

/// True when the current host is on one of the allowlists.
/// Returns true on SSR (no window) so the SSR pass doesn't render
/// a "wrong domain" banner before hydration.
export function isCanonicalHost(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.host.toLowerCase();
  const hostNoPort = normaliseHost(host);
  if (ALWAYS_TRUSTED.includes(hostNoPort)) return true;
  if (CANONICAL_HOSTS.includes(host)) return true;
  if (CANONICAL_HOSTS.includes(hostNoPort)) return true;
  const env = envAllowed();
  if (env.includes(host)) return true;
  if (env.includes(hostNoPort)) return true;
  return false;
}

/// The host the user is currently on. Used for the banner copy
/// ("you're on $host, expected $expected"). Empty string when
/// running server-side.
export function currentHost(): string {
  if (typeof window === "undefined") return "";
  return window.location.host;
}

/// First-listed canonical host — the one to point the user at
/// when surfacing the warning.
export function expectedCanonicalHost(): string {
  return CANONICAL_HOSTS[0];
}
