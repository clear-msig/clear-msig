"use client";

import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@/lib/msig/hash";
import { pkhClearSignRecipient } from "@/lib/clearsign-v2";
import { decodeSegwitAddress } from "@/lib/chain/btc";
import { decodeZcashTransparentAddress } from "@/lib/chain/zcash";
import {
  decryptApprovers,
  decryptConditions,
  decryptCooldownSeconds,
} from "@/lib/policies/encryption";
import { listPolicies } from "@/lib/policies/storage";
import type { PolicyRule, RuleCondition } from "@/lib/policies/types";

const VERSION = 1;
const MAX_RULES = 16;
const MAX_CONDITIONS = 16;
const MAX_KEYS = 16;
const U64_MAX = (1n << 64n) - 1n;

const ACTION_DENY = 0;
const ACTION_ALLOW = 1;
const ACTION_EXTRA_APPROVERS = 2;
const ACTION_COOLDOWN = 3;

const CONDITION_RECIPIENT = 1;
const CONDITION_AMOUNT = 2;
const CONDITION_TIME = 3;
const CONDITION_VELOCITY = 4;

export interface AdvancedPolicyTarget {
  chainKind: number;
  ticker: string;
  decimals: number;
}

export interface CompiledAdvancedPolicy {
  payload: Uint8Array | null;
  trackingVelocity: {
    capDisplay: string;
    windowSeconds: number;
  } | null;
}

export async function compileAdvancedPolicyRules(
  walletName: string,
  target: AdvancedPolicyTarget,
): Promise<CompiledAdvancedPolicy> {
  const compiled: Uint8Array[] = [];
  let trackingWindow = 0;

  for (const rule of listPolicies(walletName)) {
    if (!rule.enabled) continue;
    const conditions = await decryptConditions(rule.conditions);
    assertAllEncryptedRecipientsRecovered(rule, conditions);
    if (!ruleAppliesToTarget(conditions, target)) continue;

    const encodedConditions: Uint8Array[] = [];
    for (const condition of conditions) {
      if (condition.kind === "asset") continue;
      if (condition.kind === "amount" && condition.ticker && !sameTicker(condition.ticker, target.ticker)) {
        continue;
      }
      if (condition.kind === "velocity" && !sameTicker(condition.ticker, target.ticker)) {
        continue;
      }
      const encoded = encodeCondition(condition, target);
      if (encoded) encodedConditions.push(encoded);
      if (condition.kind === "velocity") {
        const window = condition.windowDays * 24 * 60 * 60;
        if (trackingWindow !== 0 && trackingWindow !== window) {
          throw new Error(
            `${target.ticker} advanced checks must use one shared velocity window for exact on-chain accounting.`,
          );
        }
        trackingWindow = window;
      }
    }

    if (encodedConditions.length > MAX_CONDITIONS) {
      throw new Error(`A policy rule supports up to ${MAX_CONDITIONS} on-chain conditions.`);
    }
    compiled.push(await encodeRule(rule, encodedConditions));
  }

  if (compiled.length === 0) return { payload: null, trackingVelocity: null };
  if (compiled.length > MAX_RULES) {
    throw new Error(`Program-enforced policies support up to ${MAX_RULES} active rules per chain.`);
  }

  const writer = new PolicyWriter();
  writer.u8(VERSION);
  writer.u8(compiled.length);
  for (const rule of compiled) writer.raw(rule);
  const payload = writer.bytes();
  if (payload.length > 1_900) {
    throw new Error("Advanced policy rules exceed the on-chain 2,048-byte proposal limit.");
  }
  return {
    payload,
    trackingVelocity:
      trackingWindow > 0
        ? {
            capDisplay: formatUnits(U64_MAX, target.decimals),
            windowSeconds: trackingWindow,
          }
        : null,
  };
}

function assertAllEncryptedRecipientsRecovered(
  rule: PolicyRule,
  conditions: RuleCondition[],
) {
  for (let index = 0; index < rule.conditions.length; index++) {
    const stored = rule.conditions[index];
    if (stored?.kind !== "recipient") continue;
    const expected = stored.encryptedAddresses?.length ?? 0;
    const recovered = conditions[index];
    if (
      expected > 0 &&
      (recovered?.kind !== "recipient" || (recovered.addresses?.length ?? 0) !== expected)
    ) {
      throw new Error(`Policy "${rule.name}" has recipient values that could not be decrypted.`);
    }
  }
}

async function encodeRule(
  rule: PolicyRule,
  conditions: Uint8Array[],
): Promise<Uint8Array> {
  const approvers =
    rule.action === "require-extra-approvers"
      ? await decryptApprovers(rule.extraApproversEncrypted)
      : [];
  if (approvers.length > MAX_KEYS) {
    throw new Error(`A policy rule supports up to ${MAX_KEYS} required approvers.`);
  }
  const cooldown =
    rule.action === "require-cooldown"
      ? Math.max(
          0,
          (await decryptCooldownSeconds(
            rule.extraCooldownEncrypted,
            rule.extraCooldownSeconds,
          )) ?? 0,
        )
      : 0;

  const writer = new PolicyWriter();
  writer.u8(actionCode(rule.action));
  writer.u8(conditions.length);
  writer.u8(approvers.length);
  writer.u32(cooldown);
  for (const approver of approvers) writer.raw(new PublicKey(approver).toBytes());
  for (const condition of conditions) writer.raw(condition);
  return writer.bytes();
}

function encodeCondition(
  condition: RuleCondition,
  target: AdvancedPolicyTarget,
): Uint8Array | null {
  const payload = new PolicyWriter();
  let kind: number;
  switch (condition.kind) {
    case "asset":
      return null;
    case "recipient": {
      kind = CONDITION_RECIPIENT;
      const recipients = [...new Set(condition.addresses ?? [])];
      if (recipients.length > MAX_KEYS) {
        throw new Error(`A recipient condition supports up to ${MAX_KEYS} addresses.`);
      }
      payload.u8(condition.mode === "allowlist" ? 1 : 2);
      payload.u8(recipients.length);
      for (const recipient of recipients) {
        payload.raw(recipientCommitment(recipient, target.chainKind));
      }
      break;
    }
    case "amount": {
      kind = CONDITION_AMOUNT;
      let flags = 0;
      const min = condition.minDisplay
        ? parseUnits(condition.minDisplay, target.decimals, target.ticker)
        : 0n;
      const max = condition.maxDisplay
        ? parseUnits(condition.maxDisplay, target.decimals, target.ticker)
        : 0n;
      if (condition.minDisplay) flags |= 1;
      if (condition.maxDisplay) flags |= 2;
      payload.u8(flags);
      payload.u64(min);
      payload.u64(max);
      break;
    }
    case "time-window": {
      kind = CONDITION_TIME;
      let daysMask = 0;
      for (const day of condition.daysOfWeek) {
        if (!Number.isInteger(day) || day < 0 || day > 6) {
          throw new Error("Policy days must be between Sunday and Saturday.");
        }
        daysMask |= 1 << day;
      }
      payload.u8(condition.startHour);
      payload.u8(condition.endHour);
      payload.u8(daysMask);
      payload.u8(condition.match === "inside" ? 1 : 2);
      payload.i16(new Date().getTimezoneOffset());
      break;
    }
    case "velocity": {
      kind = CONDITION_VELOCITY;
      payload.u64(parseUnits(condition.capDisplay, target.decimals, target.ticker));
      payload.u32(condition.windowDays * 24 * 60 * 60);
      break;
    }
  }
  const body = payload.bytes();
  const writer = new PolicyWriter();
  writer.u8(kind);
  writer.u16(body.length);
  writer.raw(body);
  return writer.bytes();
}

function ruleAppliesToTarget(
  conditions: RuleCondition[],
  target: AdvancedPolicyTarget,
): boolean {
  return conditions.every((condition) => {
    if (condition.kind === "asset") {
      if (condition.chainKind !== null && condition.chainKind !== target.chainKind) return false;
      // ERC-20 token-specific rules require chain kind 4, which does not have
      // a fixed-decimal persistent target in the current policy PDA model.
      if (condition.tokenContract) return target.chainKind === 4;
    }
    if (condition.kind === "amount" && condition.ticker) {
      return sameTicker(condition.ticker, target.ticker);
    }
    if (condition.kind === "velocity" && condition.ticker) {
      return sameTicker(condition.ticker, target.ticker);
    }
    return true;
  });
}

function recipientCommitment(value: string, chainKind: number): Uint8Array {
  const trimmed = value.trim();
  if (chainKind === 0) return new PublicKey(trimmed).toBytes();
  if (chainKind === 2) {
    const decoded = decodeSegwitAddress(trimmed);
    const normalized =
      decoded?.version === 0 && decoded.program.length === 20
        ? pkhClearSignRecipient("btc-p2wpkh", decoded.program)
        : trimmed;
    return sha256(new TextEncoder().encode(normalized));
  }
  if (chainKind === 3) {
    const decoded = decodeZcashTransparentAddress(trimmed);
    const normalized = decoded
      ? pkhClearSignRecipient("zcash-transparent", decoded.pkh)
      : trimmed;
    return sha256(new TextEncoder().encode(normalized));
  }
  return sha256(new TextEncoder().encode(trimmed.toLowerCase()));
}

function actionCode(action: PolicyRule["action"]): number {
  switch (action) {
    case "deny":
      return ACTION_DENY;
    case "allow":
      return ACTION_ALLOW;
    case "require-extra-approvers":
      return ACTION_EXTRA_APPROVERS;
    case "require-cooldown":
      return ACTION_COOLDOWN;
  }
}

function sameTicker(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function parseUnits(input: string, decimals: number, ticker: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Policy ${ticker} amount is invalid.`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Policy ${ticker} amount must use up to ${decimals} decimal places.`);
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (raw > U64_MAX) throw new Error(`Policy ${ticker} amount exceeds the on-chain limit.`);
  return raw;
}

function formatUnits(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const value = raw.toString().padStart(decimals + 1, "0");
  const whole = value.slice(0, -decimals);
  const fraction = value.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

class PolicyWriter {
  private readonly values: number[] = [];

  u8(value: number) {
    this.values.push(value & 0xff);
  }

  u16(value: number) {
    this.values.push(value & 0xff, (value >>> 8) & 0xff);
  }

  i16(value: number) {
    const normalized = value < 0 ? 0x10000 + value : value;
    this.u16(normalized);
  }

  u32(value: number) {
    for (let shift = 0; shift < 32; shift += 8) this.values.push((value >>> shift) & 0xff);
  }

  u64(value: bigint) {
    if (value < 0n || value > U64_MAX) throw new Error("Policy value must fit in u64.");
    for (let shift = 0n; shift < 64n; shift += 8n) {
      this.values.push(Number((value >> shift) & 0xffn));
    }
  }

  raw(value: Uint8Array) {
    this.values.push(...value);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.values);
  }
}
