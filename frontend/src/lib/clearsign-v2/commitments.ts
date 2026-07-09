import { sha256, toHex } from "@/lib/msig";

export function randomActionLabel(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}:0x${toHex(bytes)}`;
}

export function textCommitmentHex(value: string): string {
  return toHex(sha256(new TextEncoder().encode(value.trim())));
}

export function pkhClearSignRecipient(
  namespace: "btc-p2wpkh" | "zcash-transparent",
  pkh: Uint8Array,
): string {
  return `${namespace}:0x${toHex(pkh)}`;
}
