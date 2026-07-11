import { PublicKey } from "@solana/web3.js";
import { sha256, toHex } from "@/lib/msig/hash";
import type { PolicyEnforcementPlan } from "@/lib/policies/enforce";

const POLICY_DOMAIN = "typed-sol-send-policy-v1";
const MAGIC = [0x43, 0x53, 0x50, 0x31]; // CSP1
const EXT_VELOCITY_SOL = 1;
const EXT_SEND_COUNT = 2;
const EXT_ALLOWED_TIME = 3;
const EXT_MEMBER_ALLOWANCE = 4;
export const EXT_ADVANCED_RULES = 5;
const MEMBER_ALLOWANCE_ENTRY_LEN = 32 + 8 + 4;

export interface EncodedSolPolicy {
  bytes: Uint8Array;
  hex: string;
  commitmentHex: string;
}

export function encodeTypedSolPolicy(
  plan: PolicyEnforcementPlan,
): EncodedSolPolicy | null {
  // Deny is encoded as an empty allowlist (mode=1, no recipients) so a
  // WalletPolicy commitment can force on-chain rejection even if the UI is bypassed.
  const isDeny = plan.evaluation?.action === "deny";

  let mode = isDeny
    ? 1
    : plan.recipientGuard?.mode === "allowlist"
      ? 1
      : plan.recipientGuard?.mode === "blocklist"
        ? 2
        : 0;
  let recipients: string[] = isDeny ? [] : plan.recipientGuard?.addresses ?? [];
  let maxAmountLamports = 0n;
  let velocityCapLamports = plan.onchainLimits.velocityCapDisplay
    ? parseSolLamports(plan.onchainLimits.velocityCapDisplay)
    : 0n;
  let velocityWindowSeconds = velocityCapLamports > 0n
    ? plan.onchainLimits.velocityWindowSeconds
    : 0;
  const maxSendCount = plan.onchainLimits.maxSendCount;
  const countWindowSeconds = maxSendCount > 0
    ? plan.onchainLimits.countWindowSeconds
    : 0;

  if (!isDeny) {
    for (const condition of plan.conditions) {
      if (condition.kind === "recipient") {
        ({ mode, recipients } = mergeRecipientPolicy(
          mode,
          recipients,
          condition.mode === "allowlist" ? 1 : 2,
          condition.addresses ?? [],
        ));
      } else if (condition.kind === "amount") {
        const ticker = condition.ticker?.trim().toUpperCase();
        if (!ticker || ticker === "SOL") {
          maxAmountLamports = condition.maxDisplay
            ? parseSolLamports(condition.maxDisplay)
            : 0n;
        }
      } else if (condition.kind === "velocity") {
        const ticker = condition.ticker?.trim().toUpperCase();
        if (!ticker || ticker === "SOL") {
          const conditionCap = condition.capDisplay
            ? parseSolLamports(condition.capDisplay)
            : 0n;
          velocityCapLamports = stricterCap(velocityCapLamports, conditionCap);
          if (conditionCap > 0n) {
            velocityWindowSeconds = condition.windowDays * 24 * 60 * 60;
          }
        }
      }
    }
  }

  // Encode extra-approver / cooldown whenever the plan carries them, not only
  // when the matched rule action name matches (supports persisted personal policy).
  const requiredApprovers = plan.extraApprovers;
  const extraCooldownSeconds = plan.extraCooldownSeconds;
  recipients = dedupe(recipients);
  assertPolicyKeyCounts(recipients.length, requiredApprovers.length);
  const memberAllowances = plan.memberAllowances ?? [];

  if (
    !isDeny &&
    mode === 0 &&
    maxAmountLamports === 0n &&
    velocityCapLamports === 0n &&
    requiredApprovers.length === 0 &&
    extraCooldownSeconds === 0 &&
    maxSendCount === 0 &&
    !plan.allowedTimeWindow &&
    memberAllowances.length === 0
  ) {
    return null;
  }

  const writer = new ByteWriter();
  writer.pushRaw(new Uint8Array(MAGIC));
  writer.pushU8(mode);
  writer.pushU64(maxAmountLamports);
  writer.pushU32(Math.max(0, extraCooldownSeconds));
  writer.pushU8(recipients.length);
  writer.pushU8(requiredApprovers.length);
  for (const recipient of recipients) writer.pushPubkey(recipient);
  for (const approver of requiredApprovers) writer.pushPubkey(approver);
  if (velocityCapLamports > 0n && velocityWindowSeconds > 0) {
    writer.pushU8(EXT_VELOCITY_SOL);
    writer.pushU16(12);
    writer.pushU64(velocityCapLamports);
    writer.pushU32(velocityWindowSeconds);
  }
  if (maxSendCount > 0 && countWindowSeconds > 0) {
    writer.pushU8(EXT_SEND_COUNT);
    writer.pushU16(8);
    writer.pushU32(maxSendCount);
    writer.pushU32(countWindowSeconds);
  }
  writeAllowedTimeExtension(writer, plan.allowedTimeWindow);
  writeMemberAllowanceExtension(writer, memberAllowances, 9, "SOL");

  const bytes = writer.bytes();
  return {
    bytes,
    hex: toHex(bytes),
    commitmentHex: policyCommitmentHex(bytes),
  };
}

export function encodeTypedRemoteSendPolicy(
  plan: PolicyEnforcementPlan,
  options: {
    assetTicker: string;
    decimals?: number;
    normalizeRecipient?: (value: string) => string;
  },
): EncodedSolPolicy | null {
  const isDeny = plan.evaluation?.action === "deny";
  const ticker = options.assetTicker.trim().toUpperCase();
  const decimals = options.decimals ?? 18;
  const normalizeRecipient =
    options.normalizeRecipient ?? ((value: string) => value.trim());

  let mode = isDeny
    ? 1
    : plan.recipientGuard?.mode === "allowlist"
      ? 1
      : plan.recipientGuard?.mode === "blocklist"
        ? 2
        : 0;
  let recipientTexts: string[] = isDeny
    ? []
    : (plan.recipientGuard?.addresses ?? []).map(normalizeRecipient);
  let maxAmountRaw = 0n;
  let velocityCapRaw = plan.onchainLimits.velocityCapDisplay
    ? parseUnits(plan.onchainLimits.velocityCapDisplay, decimals, ticker)
    : 0n;
  let velocityWindowSeconds = velocityCapRaw > 0n
    ? plan.onchainLimits.velocityWindowSeconds
    : 0;
  const maxSendCount = plan.onchainLimits.maxSendCount;
  const countWindowSeconds = maxSendCount > 0
    ? plan.onchainLimits.countWindowSeconds
    : 0;

  if (!isDeny) {
    for (const condition of plan.conditions) {
      if (condition.kind === "recipient") {
        ({ mode, recipients: recipientTexts } = mergeRecipientPolicy(
          mode,
          recipientTexts,
          condition.mode === "allowlist" ? 1 : 2,
          (condition.addresses ?? []).map(normalizeRecipient),
        ));
      } else if (condition.kind === "amount") {
        const conditionTicker = condition.ticker?.trim().toUpperCase();
        if (!conditionTicker || conditionTicker === ticker) {
          maxAmountRaw = condition.maxDisplay
            ? parseUnits(condition.maxDisplay, decimals, ticker)
            : 0n;
        }
      } else if (condition.kind === "velocity") {
        const conditionTicker = condition.ticker?.trim().toUpperCase();
        if (!conditionTicker || conditionTicker === ticker) {
          const conditionCap = condition.capDisplay
            ? parseUnits(condition.capDisplay, decimals, ticker)
            : 0n;
          velocityCapRaw = stricterCap(velocityCapRaw, conditionCap);
          if (conditionCap > 0n) {
            velocityWindowSeconds = condition.windowDays * 24 * 60 * 60;
          }
        }
      }
    }
  }

  const requiredApprovers = plan.extraApprovers;
  const extraCooldownSeconds = plan.extraCooldownSeconds;
  recipientTexts = dedupe(recipientTexts);
  assertPolicyKeyCounts(recipientTexts.length, requiredApprovers.length);
  const memberAllowances = plan.memberAllowances ?? [];

  if (
    !isDeny &&
    mode === 0 &&
    maxAmountRaw === 0n &&
    velocityCapRaw === 0n &&
    requiredApprovers.length === 0 &&
    extraCooldownSeconds === 0 &&
    maxSendCount === 0 &&
    !plan.allowedTimeWindow &&
    memberAllowances.length === 0
  ) {
    return null;
  }

  const writer = new ByteWriter();
  const recipients = dedupe(recipientTexts).map(textCommitment);
  writer.pushRaw(new Uint8Array(MAGIC));
  writer.pushU8(mode);
  writer.pushU64(maxAmountRaw);
  writer.pushU32(Math.max(0, extraCooldownSeconds));
  writer.pushU8(recipients.length);
  writer.pushU8(requiredApprovers.length);
  for (const recipient of recipients) writer.pushRaw32(recipient);
  for (const approver of requiredApprovers) writer.pushPubkey(approver);
  if (velocityCapRaw > 0n && velocityWindowSeconds > 0) {
    writer.pushU8(EXT_VELOCITY_SOL);
    writer.pushU16(12);
    writer.pushU64(velocityCapRaw);
    writer.pushU32(velocityWindowSeconds);
  }
  if (maxSendCount > 0 && countWindowSeconds > 0) {
    writer.pushU8(EXT_SEND_COUNT);
    writer.pushU16(8);
    writer.pushU32(maxSendCount);
    writer.pushU32(countWindowSeconds);
  }
  writeAllowedTimeExtension(writer, plan.allowedTimeWindow);
  writeMemberAllowanceExtension(writer, memberAllowances, decimals, ticker);

  const bytes = writer.bytes();
  return {
    bytes,
    hex: toHex(bytes),
    commitmentHex: policyCommitmentHex(bytes),
  };
}

export function policyCommitmentHexForParts(parts: string[]): string {
  const writer = new ByteWriter();
  writer.pushBytes("clearsig:policy-engine:v2:policy");
  writer.pushU32(parts.length);
  parts.forEach((part) => writer.pushBytes(part));
  return toHex(sha256(writer.bytes()));
}

export function policyCommitmentHex(policyBytes: Uint8Array): string {
  const writer = new ByteWriter();
  writer.pushBytes("clearsig:policy-engine:v2:policy");
  writer.pushU32(2);
  writer.pushBytes(POLICY_DOMAIN);
  writer.pushBytes(policyBytes);
  return toHex(sha256(writer.bytes()));
}

export function appendPolicyExtension(
  encoded: EncodedSolPolicy | null,
  tag: number,
  payload: Uint8Array,
): EncodedSolPolicy {
  if (!Number.isInteger(tag) || tag < 0 || tag > 255) {
    throw new Error("Policy extension tag must fit in one byte.");
  }
  if (payload.length > 0xffff) {
    throw new Error("Policy extension is too large.");
  }
  const base = encoded?.bytes ?? emptyPolicyBytes();
  const bytes = new Uint8Array(base.length + 3 + payload.length);
  bytes.set(base, 0);
  bytes[base.length] = tag;
  bytes[base.length + 1] = payload.length & 0xff;
  bytes[base.length + 2] = payload.length >>> 8;
  bytes.set(payload, base.length + 3);
  return {
    bytes,
    hex: toHex(bytes),
    commitmentHex: policyCommitmentHex(bytes),
  };
}

function emptyPolicyBytes(): Uint8Array {
  const bytes = new Uint8Array(19);
  bytes.set(MAGIC, 0);
  return bytes;
}

function parseSolLamports(input: string): bigint {
  return parseUnits(input, 9, "SOL");
}

function parseUnits(input: string, decimals: number, ticker: string): bigint {
  const trimmed = input.trim();
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    !/^\d+(\.\d+)?$/.test(trimmed)
  ) {
    throw new Error(`Policy ${ticker} amount is invalid.`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `Policy ${ticker} amount must use up to ${decimals} decimal places.`,
    );
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

function textCommitment(value: string): Uint8Array {
  return sha256(new TextEncoder().encode(value.trim()));
}

function stricterCap(current: bigint, candidate: bigint): bigint {
  if (current === 0n) return candidate;
  if (candidate === 0n) return current;
  return current < candidate ? current : candidate;
}

function mergeRecipientPolicy(
  currentMode: number,
  current: string[],
  nextMode: number,
  next: string[],
): { mode: number; recipients: string[] } {
  if (currentMode === 0) return { mode: nextMode, recipients: dedupe(next) };
  if (nextMode === 0) return { mode: currentMode, recipients: dedupe(current) };
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  if (currentMode === 1 && nextMode === 1) {
    return { mode: 1, recipients: current.filter((value) => nextSet.has(value)) };
  }
  if (currentMode === 2 && nextMode === 2) {
    return { mode: 2, recipients: dedupe([...current, ...next]) };
  }
  const allowlist = currentMode === 1 ? current : next;
  const blocklist = currentMode === 2 ? currentSet : nextSet;
  return { mode: 1, recipients: allowlist.filter((value) => !blocklist.has(value)) };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function assertPolicyKeyCounts(recipientCount: number, approverCount: number) {
  if (recipientCount > 16) {
    throw new Error("Program-enforced recipient policies support up to 16 addresses.");
  }
  if (approverCount > 16) {
    throw new Error("Program-enforced approval policies support up to 16 approvers.");
  }
}

function writeAllowedTimeExtension(
  writer: ByteWriter,
  window: PolicyEnforcementPlan["allowedTimeWindow"],
) {
  if (!window) return;
  if (
    !Number.isInteger(window.startHour) ||
    !Number.isInteger(window.endHour) ||
    window.startHour < 0 ||
    window.startHour > 23 ||
    window.endHour < 0 ||
    window.endHour > 23
  ) {
    throw new Error("Policy allowed hours must use whole hours from 0 to 23.");
  }
  let daysMask = 0;
  for (const day of window.daysOfWeek) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error("Policy allowed days must be between Sunday and Saturday.");
    }
    daysMask |= 1 << day;
  }
  writer.pushU8(EXT_ALLOWED_TIME);
  writer.pushU16(5);
  writer.pushU8(window.startHour);
  writer.pushU8(window.endHour);
  writer.pushU8(daysMask);
  writer.pushI16(window.utcOffsetMinutes);
}

function writeMemberAllowanceExtension(
  writer: ByteWriter,
  caps: NonNullable<PolicyEnforcementPlan["memberAllowances"]>,
  decimals: number,
  ticker: string,
) {
  if (!caps || caps.length === 0) return;
  if (caps.length > 8) {
    throw new Error("Program-enforced member allowances support up to 8 members.");
  }
  const payload = new ByteWriter();
  for (const cap of caps) {
    payload.pushPubkey(cap.member);
    payload.pushU64(parseUnits(cap.capDisplay, decimals, ticker));
    payload.pushU32(Math.max(0, Math.floor(cap.windowSeconds)));
  }
  const bytes = payload.bytes();
  if (bytes.length !== caps.length * MEMBER_ALLOWANCE_ENTRY_LEN) {
    throw new Error("Member allowance extension encoding length mismatch.");
  }
  writer.pushU8(EXT_MEMBER_ALLOWANCE);
  writer.pushU16(bytes.length);
  writer.pushRaw(bytes);
}

class ByteWriter {
  private chunks: number[] = [];

  pushRaw(bytes: Uint8Array) {
    bytes.forEach((byte) => this.chunks.push(byte));
  }

  pushBytes(value: string | Uint8Array) {
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.pushU32(bytes.length);
    this.pushRaw(bytes);
  }

  pushPubkey(value: string) {
    this.pushRaw(new PublicKey(value).toBytes());
  }

  pushRaw32(value: Uint8Array) {
    if (value.length !== 32) {
      throw new Error(`Policy 32-byte value must be 32 bytes, got ${value.length}.`);
    }
    this.pushRaw(value);
  }

  pushU8(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("Policy byte value is out of range.");
    }
    this.chunks.push(value);
  }

  pushU16(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error("Policy u16 value is out of range.");
    }
    this.chunks.push(value & 0xff, (value >> 8) & 0xff);
  }

  pushI16(value: number) {
    if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
      throw new Error("Policy i16 value is out of range.");
    }
    const unsigned = value & 0xffff;
    this.chunks.push(unsigned & 0xff, (unsigned >> 8) & 0xff);
  }

  pushU32(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error("Policy u32 value is out of range.");
    }
    for (let i = 0; i < 4; i++) this.chunks.push((value >> (8 * i)) & 0xff);
  }

  pushU64(value: bigint) {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new Error("Policy u64 value is out of range.");
    }
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number((value >> BigInt(8 * i)) & 0xffn));
    }
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}
