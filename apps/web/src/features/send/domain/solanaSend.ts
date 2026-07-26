import { sha256, toHex } from "@/lib/msig";
import type { Contact } from "@/lib/retail/contacts";

export type ResolvedSolanaRecipient =
  | { kind: "empty" }
  | { kind: "contact"; contact: Contact }
  | { kind: "address"; address: string }
  | { kind: "sns"; name: string; address: string }
  | { kind: "resolving"; name: string }
  | { kind: "unknown" };

// Cosmetic formatter for the typed SOL amount - locale-grouped with
// up to four decimals (matches Solana's catalog `displayDecimals`).
export function formatAmount(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

// Lamports (bigint) → SOL string, byte-accurate. Used for wallet
// balance display and for the Max button (which needs to round-trip
// through the amount input). 1 SOL = 1e9 lamports.
export function formatLamports(lamports: bigint, displayDecimals = 4): string {
  if (lamports === 0n) return "0";
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = abs % 1_000_000_000n;
  if (frac === 0n) return `${negative ? "-" : ""}${whole}`;
  let fracStr = frac.toString().padStart(9, "0");
  fracStr = fracStr.replace(/0+$/, "").slice(0, displayDecimals);
  return `${negative ? "-" : ""}${whole}${fracStr ? "." + fracStr : ""}`;
}

// 32 random bytes as a 0x-prefixed hex string. Each proposal needs a
// fresh nonce so the message hash never repeats.
// Tag/read helpers for the "execute failed after propose succeeded"
// case. We mark the thrown error with the proposal address so the
// onError handler can render a "retry from the proposal page" CTA
// without inspecting opaque error strings.
const EXECUTE_FAIL_KEY = "__clearMsigExecuteFailedProposal";

export function tagExecuteFailure(err: unknown, proposalPda: string): void {
  if (err && typeof err === "object") {
    (err as Record<string, unknown>)[EXECUTE_FAIL_KEY] = proposalPda;
  }
}

export function readExecuteFailureProposal(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const v = (err as Record<string, unknown>)[EXECUTE_FAIL_KEY];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// Strip a Solana wallet-scheme prefix from a scanned QR. Phantom +
// most Solana QR sources emit `solana:<address>?amount=…&memo=…`;
// we keep just the address. Anything we can't parse passes through
// unchanged so users can also scan plain base58.
export function parseSolanaRecipientFromQr(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (m) return m[1];
  return trimmed;
}

function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

export function randomActionLabel(prefix: string): string {
  return `${prefix}:${generateNonceHex()}`;
}

export function policyCommitmentHex(parts: string[]): string {
  const writer = new TinyByteWriter();
  writer.pushBytes("clearsig:policy-engine:v2:policy");
  writer.pushU32(parts.length);
  parts.forEach((part) => writer.pushBytes(part));
  return toHex(sha256(writer.bytes()));
}

export function lamportsToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is too large for this browser.");
  }
  return Number(value);
}

class TinyByteWriter {
  private chunks: number[] = [];

  pushBytes(value: string | Uint8Array) {
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.pushU32(bytes.length);
    bytes.forEach((byte) => this.chunks.push(byte));
  }

  pushU32(value: number) {
    for (let i = 0; i < 4; i++) this.chunks.push((value >> (8 * i)) & 0xff);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

// Build the SignPayloadPreview detail rows for /send. Stays a pure
// function so it can render the policy impact (per-chain + wallet-
// wide) without dragging hook plumbing into the JSX.
