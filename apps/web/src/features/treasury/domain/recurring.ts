import type { ClearSignIntentInput, RecurringSchedulePayload } from "@/lib/clearsign";

export const RECURRING_INTERVALS = {
  Weekly: 7 * 24 * 60 * 60,
  Monthly: 30 * 24 * 60 * 60,
} as const;

export interface RecurringDraft {
  name: string;
  recipient: string;
  amount: string;
  cadence: keyof typeof RECURRING_INTERVALS;
  firstRun: string;
  paymentCount: string;
  note: string;
}

export function solToLamports(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
    throw new Error("Enter a SOL amount with up to 9 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const raw = BigInt(whole) * 1_000_000_000n + BigInt((fraction + "000000000").slice(0, 9));
  if (raw <= 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The recurring amount is outside the supported range.");
  }
  return Number(raw);
}

export function firstRunUnix(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Choose the first payment time.");
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < Math.floor(Date.now() / 1000) + 60) {
    throw new Error("The first payment must be at least one minute from now.");
  }
  return seconds;
}

export function paymentCount(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
    throw new Error("Payment count must be between 1 and 1000.");
  }
  return count;
}

export function recurringEnvelope(input: {
  walletName: string;
  scheduleId: string;
  recipient: string;
  amount: string;
  intervalSeconds: number;
  firstExecutionAt: number;
  paymentCount: number;
  status: "active" | "revoked";
  reason?: string;
}): ClearSignIntentInput<RecurringSchedulePayload> {
  return {
    kind: "recurring_schedule",
    network: "Solana devnet",
    walletName: input.walletName,
    actionId: randomLabel("recurring"),
    nonce: randomLabel("nonce"),
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
    payload: {
      scheduleId: input.scheduleId,
      recipient: input.recipient,
      recipientEncoding: "solana_pubkey",
      amount: input.amount,
      asset: "SOL",
      assetEncoding: "text",
      decimals: 9,
      displayAsset: "SOL",
      intervalSeconds: input.intervalSeconds,
      firstExecutionAt: input.firstExecutionAt,
      paymentCount: input.paymentCount,
      status: input.status,
      reason: input.reason || undefined,
    },
  };
}

export function newScheduleId(): string {
  return `schedule-${crypto.randomUUID()}`;
}

function randomLabel(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
