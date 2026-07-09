import { PublicKey } from "@solana/web3.js";
import { sha256, toHex } from "@/lib/msig/hash";
import type { PolicyEnforcementPlan } from "@/lib/policies/enforce";

const POLICY_DOMAIN = "typed-sol-send-policy-v1";
const MAGIC = [0x43, 0x53, 0x50, 0x31]; // CSP1
const EXT_VELOCITY_SOL = 1;

export interface EncodedSolPolicy {
  bytes: Uint8Array;
  hex: string;
  commitmentHex: string;
}

export function encodeTypedSolPolicy(
  plan: PolicyEnforcementPlan,
): EncodedSolPolicy | null {
  if (!plan.evaluation?.matched || !plan.rule || plan.evaluation.action === "deny") {
    return null;
  }

  let mode = 0;
  let recipients: string[] = [];
  let maxAmountLamports = 0n;
  let velocityCapLamports = 0n;
  let velocityWindowSeconds = 0;

  for (const condition of plan.conditions) {
    if (condition.kind === "recipient") {
      mode = condition.mode === "allowlist" ? 1 : 2;
      recipients = condition.addresses ?? [];
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
        velocityCapLamports = condition.capDisplay
          ? parseSolLamports(condition.capDisplay)
          : 0n;
        velocityWindowSeconds = condition.windowDays * 24 * 60 * 60;
      }
    }
  }

  const requiredApprovers =
    plan.rule.action === "require-extra-approvers" ? plan.extraApprovers : [];
  const extraCooldownSeconds =
    plan.rule.action === "require-cooldown" ? plan.extraCooldownSeconds : 0;

  if (
    mode === 0 &&
    maxAmountLamports === 0n &&
    velocityCapLamports === 0n &&
    requiredApprovers.length === 0 &&
    extraCooldownSeconds === 0
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
  if (!plan.evaluation?.matched || !plan.rule || plan.evaluation.action === "deny") {
    return null;
  }

  const ticker = options.assetTicker.trim().toUpperCase();
  const decimals = options.decimals ?? 18;
  const normalizeRecipient =
    options.normalizeRecipient ?? ((value: string) => value.trim());

  let mode = 0;
  let recipients: Uint8Array[] = [];
  let maxAmountRaw = 0n;
  let velocityCapRaw = 0n;
  let velocityWindowSeconds = 0;

  for (const condition of plan.conditions) {
    if (condition.kind === "recipient") {
      mode = condition.mode === "allowlist" ? 1 : 2;
      recipients = (condition.addresses ?? []).map((address) =>
        textCommitment(normalizeRecipient(address)),
      );
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
        velocityCapRaw = condition.capDisplay
          ? parseUnits(condition.capDisplay, decimals, ticker)
          : 0n;
        velocityWindowSeconds = condition.windowDays * 24 * 60 * 60;
      }
    }
  }

  const requiredApprovers =
    plan.rule.action === "require-extra-approvers" ? plan.extraApprovers : [];
  const extraCooldownSeconds =
    plan.rule.action === "require-cooldown" ? plan.extraCooldownSeconds : 0;

  if (
    mode === 0 &&
    maxAmountRaw === 0n &&
    velocityCapRaw === 0n &&
    requiredApprovers.length === 0 &&
    extraCooldownSeconds === 0
  ) {
    return null;
  }

  const writer = new ByteWriter();
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

function policyCommitmentHex(policyBytes: Uint8Array): string {
  const writer = new ByteWriter();
  writer.pushBytes("clearsig:policy-engine:v2:policy");
  writer.pushU32(2);
  writer.pushBytes(POLICY_DOMAIN);
  writer.pushBytes(policyBytes);
  return toHex(sha256(writer.bytes()));
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
