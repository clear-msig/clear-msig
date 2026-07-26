import { sha256, toHex } from "@/lib/msig/hash";

const encoder = new TextEncoder();
const ZERO_HASH = "0".repeat(64);

export function hashAgentText(value: string): string {
  return toHex(sha256(encoder.encode(value.trim())));
}

export function normalizeAgentHash(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ZERO_HASH;
}

export function decimalToAgentUsdRaw(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) return "0";
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole || "0") * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  ).toString();
}
