import type { ClearSignIntentInput, RecurringSchedulePayload } from "@/lib/clearsign";

export const RECURRING_INTERVALS = {
  Weekly: 7 * 24 * 60 * 60,
  Monthly: 30 * 24 * 60 * 60,
} as const;

export interface RecurringDraft {
  name: string;
  recipient: string;
  amount: string;
  asset: "SOL" | "USDC";
  cadence: keyof typeof RECURRING_INTERVALS;
  firstRun: string;
  paymentCount: string;
  note: string;
}

export function solToLamports(value: string): number {
  return recurringAmountToRaw(value, "SOL");
}

export function recurringAmountToRaw(value: string, asset: "SOL" | "USDC"): number {
  const decimals = asset === "SOL" ? 9 : 6;
  const normalized = value.trim();
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(normalized)) {
    throw new Error(`Enter a ${asset} amount with up to ${decimals} decimals.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const scale = 10n ** BigInt(decimals);
  const raw = BigInt(whole) * scale
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
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
  asset: "SOL" | "USDC";
  mint?: string;
  sourceToken?: string;
  destinationToken?: string;
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
      asset: input.asset === "SOL" ? "SOL" : requireTokenField(input.mint, "mint"),
      assetEncoding: input.asset === "SOL" ? "text" : "solana_pubkey",
      decimals: input.asset === "SOL" ? 9 : 6,
      displayAsset: input.asset,
      sourceToken: input.asset === "USDC"
        ? requireTokenField(input.sourceToken, "source token account")
        : undefined,
      destinationToken: input.asset === "USDC"
        ? requireTokenField(input.destinationToken, "destination token account")
        : undefined,
      intervalSeconds: input.intervalSeconds,
      firstExecutionAt: input.firstExecutionAt,
      paymentCount: input.paymentCount,
      status: input.status,
      reason: input.reason || undefined,
    },
  };
}

function requireTokenField(value: string | undefined, label: string): string {
  if (!value) throw new Error(`The USDC ${label} is required.`);
  return value;
}

export function newScheduleId(): string {
  return `schedule-${crypto.randomUUID()}`;
}

function randomLabel(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
