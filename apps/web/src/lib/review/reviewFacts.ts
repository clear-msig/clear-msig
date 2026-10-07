// Plain-language facts derived from a verified canonical review.
//
// Everything here is a *presentation* of fields the program already commits
// to. Nothing is read from outside the verified document except the vault
// balance and the clock, and both are labelled as such by the caller. The
// exact document stays on screen unchanged; these helpers never replace it.

export interface ReviewFacts {
  amount: { value: string; ticker: string } | null;
  destination: string | null;
  network: string | null;
}

function field(text: string, label: string): string | null {
  for (const line of text.split("\n")) {
    if (line.startsWith(label)) return line.slice(label.length).trim() || null;
  }
  return null;
}

export function parseReviewFacts(
  sections: readonly { title: string; text: string }[],
): ReviewFacts {
  const details = sections.find((s) => s.title === "DETAILS")?.text ?? "";
  const amountRaw = field(details, "Amount:");
  let amount: ReviewFacts["amount"] = null;
  if (amountRaw) {
    const m = /^([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9]{1,12})$/.exec(amountRaw);
    if (m) amount = { value: m[1], ticker: m[2] };
  }
  return {
    amount,
    destination: field(details, "To:") ?? field(details, "Recipient:"),
    network: field(details, "Network:"),
  };
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/// Exact decimal -> lamports. Returns null for anything that is not a plain
/// non-negative decimal with at most nine fractional digits (no floats).
export function solToLamports(value: string): bigint | null {
  const m = /^([0-9]+)(?:\.([0-9]{1,9}))?$/.exec(value);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(9, "0");
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt(frac);
}

export function formatSol(lamports: bigint): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  const trimmed = frac.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

export interface BalanceChange {
  before: bigint;
  after: bigint;
  /** True when the vault holds less than the amount being sent. */
  insufficient: boolean;
}

export function balanceChange(
  vaultLamports: bigint,
  amountLamports: bigint,
): BalanceChange {
  return {
    before: vaultLamports,
    after: vaultLamports - amountLamports,
    insufficient: vaultLamports < amountLamports,
  };
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function describeDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return plural(s, "second");
  if (s < 3600) return plural(Math.round(s / 60), "minute");
  if (s < 86_400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m === 0 || h >= 10
      ? plural(h, "hour")
      : `${plural(h, "hour")} ${plural(m, "minute")}`;
  }
  return plural(Math.round(s / 86_400), "day");
}

export interface ExpiryDescription {
  expired: boolean;
  /** "Expires in 23 hours" / "Expired 2 hours ago" */
  relative: string;
  /** Fixed-zone, locale-independent: "2026-10-08 14:02 UTC" */
  absoluteUtc: string;
}

export function describeExpiry(
  expiresAtSeconds: bigint,
  nowMs: number,
): ExpiryDescription {
  const expiresMs = Number(expiresAtSeconds) * 1000;
  const date = new Date(expiresMs);
  const iso = Number.isFinite(expiresMs) ? date.toISOString() : "";
  const absoluteUtc = iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "";
  const deltaSeconds = (expiresMs - nowMs) / 1000;
  const expired = deltaSeconds <= 0;
  return {
    expired,
    relative: expired
      ? `Expired ${describeDuration(-deltaSeconds)} ago`
      : `Expires in ${describeDuration(deltaSeconds)}`,
    absoluteUtc,
  };
}

export function describeTimelock(seconds: number, threshold: number): string {
  const approvals = `${threshold} ${threshold === 1 ? "approval" : "approvals"}`;
  return seconds <= 0
    ? `No delay: it can run as soon as ${approvals} ${threshold === 1 ? "is" : "are"} in.`
    : `After ${approvals}, it waits ${describeDuration(seconds)} before it can run.`;
}
