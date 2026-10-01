import { sha256, toHex } from "@/lib/msig/hash";

export function integer(
  value: bigint | number,
  size: number,
  signed = false,
): Uint8Array {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Invalid canonical integer.");
  const n = BigInt(value),
    bits = BigInt(size * 8);
  if (
    n < (signed ? -(1n << (bits - 1n)) : 0n) ||
    n >= 1n << (signed ? bits - 1n : bits)
  )
    throw new Error("Canonical integer out of range.");
  const encoded = BigInt.asUintN(size * 8, n);
  return Uint8Array.from({ length: size }, (_, i) =>
    Number((encoded >> BigInt(i * 8)) & 255n),
  );
}
function concat(rows: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(rows.reduce((n, row) => n + row.length, 0));
  let offset = 0;
  for (const row of rows) {
    output.set(row, offset);
    offset += row.length;
  }
  return output;
}
export function bytes(value: Uint8Array): Uint8Array {
  return concat([integer(value.length, 4), value]);
}
export function digest(rows: readonly Uint8Array[]): string {
  return toHex(sha256(concat(rows)));
}
