import { PublicKey } from "@solana/web3.js";
import { sha256, toHex } from "@/lib/msig/hash";
import type { PolicyEnforcementPlan } from "@/lib/policies/enforce";

const POLICY_DOMAIN = "typed-sol-send-policy-v1";
const MAGIC = [0x43, 0x53, 0x50, 0x31]; // CSP1

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
    }
  }

  const requiredApprovers =
    plan.rule.action === "require-extra-approvers" ? plan.extraApprovers : [];
  const extraCooldownSeconds =
    plan.rule.action === "require-cooldown" ? plan.extraCooldownSeconds : 0;

  if (
    mode === 0 &&
    maxAmountLamports === 0n &&
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
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,9})?$/.test(trimmed)) {
    throw new Error("Policy SOL amount must use up to 9 decimal places.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
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

  pushU8(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("Policy byte value is out of range.");
    }
    this.chunks.push(value);
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
