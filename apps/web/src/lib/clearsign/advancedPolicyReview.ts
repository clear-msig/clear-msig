import { PublicKey } from "@solana/web3.js";

/** Mirrors advanced_policy.rs v1. Display only: never evaluates or authorizes a transfer. */
export function reviewAdvancedPolicy(
  bytes: Uint8Array,
  amount: (raw: bigint) => string,
  trackingWindowSeconds?: number,
): string[] {
  let at = 0;
  const take = (n: number) => {
    if (at + n > bytes.length)
      throw new Error("Truncated advanced policy rule.");
    const slice = bytes.subarray(at, at + n);
    at += n;
    return slice;
  };
  const u8 = () => take(1)[0];
  const u32 = () => {
    const b = take(4);
    return new DataView(b.buffer, b.byteOffset, b.length).getUint32(0, true);
  };
  if (u8() !== 1) throw new Error("Unsupported advanced policy version.");
  const count = u8();
  if (count > 16) throw new Error("Too many advanced policy rules.");
  const result = [
    "Advanced rules: First matching rule only. Every condition in that rule must match. No match adds no restriction; all base policy and governance rules still apply.",
  ];
  for (let n = 0; n < count; n++) {
    const action = u8(),
      conditions = u8(),
      approverCount = u8(),
      delay = u32();
    if (
      action > 3 ||
      conditions > 16 ||
      approverCount > 16 ||
      (action === 2 && approverCount === 0) ||
      (action === 3 && delay === 0) ||
      (action !== 2 && approverCount !== 0) ||
      (action !== 3 && delay !== 0)
    )
      throw new Error("Invalid or ambiguous advanced rule action.");
    const approvers = Array.from({ length: approverCount }, () =>
      new PublicKey(take(32)).toBase58(),
    );
    const effect =
      action === 0
        ? "Deny the transfer"
        : action === 1
          ? "Add no extra restriction (base rules still apply)"
          : action === 2
            ? `Require approvals from ${approvers.join(", ")}`
            : `Require an additional ${delay}-second delay after approval and the governance timelock`;
    result.push(
      `Rule ${n + 1}: ${effect}`,
      conditions === 0
        ? "When: Always (no conditions)"
        : "When ALL of these conditions match:",
    );
    for (let c = 0; c < conditions; c++) {
      const kind = u8(),
        sizeBytes = take(2),
        size = new DataView(
          sizeBytes.buffer,
          sizeBytes.byteOffset,
          2,
        ).getUint16(0, true),
        payload = take(size),
        view = new DataView(payload.buffer, payload.byteOffset, payload.length);
      if (kind === 1) {
        const mode = payload[0],
          keys = payload[1];
        if (
          size < 2 ||
          ![1, 2].includes(mode) ||
          keys > 16 ||
          size !== 2 + keys * 32
        )
          throw new Error("Invalid advanced recipient condition.");
        const addresses = Array.from({ length: keys }, (_, k) =>
          new PublicKey(payload.subarray(2 + k * 32, 34 + k * 32)).toBase58(),
        );
        result.push(
          keys
            ? `Recipient is ${mode === 1 ? "one of" : "not one of"}: ${addresses.join(", ")}`
            : mode === 1
              ? "Recipient: No address can match this empty allowlist"
              : "Recipient: Every address matches this empty blocklist",
        );
      } else if (kind === 2 && size === 17) {
        const flags = payload[0],
          min = view.getBigUint64(1, true),
          max = view.getBigUint64(9, true);
        if (
          flags > 3 ||
          (!(flags & 1) && min !== 0n) ||
          (!(flags & 2) && max !== 0n)
        )
          throw new Error("Invalid or ambiguous amount condition.");
        result.push(
          `Amount: ${flags & 1 ? `at least ${amount(min)}` : "no lower bound"}; ${flags & 2 ? `at most ${amount(max)}` : "no upper bound"}${flags === 3 && min > max ? " (no amount can satisfy these bounds)" : ""}`,
        );
      } else if (kind === 3 && size === 6) {
        const start = payload[0],
          end = payload[1],
          mask = payload[2],
          mode = payload[3],
          offset = view.getInt16(4, true);
        if (
          start > 23 ||
          end > 23 ||
          mask > 127 ||
          ![1, 2].includes(mode) ||
          Math.abs(offset) > 840
        )
          throw new Error("Invalid advanced time condition.");
        const signed = -offset,
          zone = `UTC${signed < 0 ? "-" : "+"}${String(Math.floor(Math.abs(signed) / 60)).padStart(2, "0")}:${String(Math.abs(signed) % 60).padStart(2, "0")}`;
        const days =
          mask === 0
            ? "every day"
            : [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ]
                .filter((_, i) => mask & (1 << i))
                .join(", ");
        result.push(
          start === end
            ? `Time: ${mode === 1 ? "Never matches (empty time window)" : "Always matches (outside an empty time window)"}`
            : `Time is ${mode === 1 ? "inside" : "outside"} the combined window: ${String(start).padStart(2, "0")}:00 inclusive to ${String(end).padStart(2, "0")}:00 exclusive${start > end ? " (overnight)" : ""}, ${days}, fixed ${zone}`,
        );
      } else if (kind === 4 && size === 12) {
        const cap = view.getBigUint64(0, true),
          window = view.getUint32(8, true);
        if (cap === 0n || window === 0)
          throw new Error("Invalid advanced velocity condition.");
        if (trackingWindowSeconds !== window)
          throw new Error(
            "Advanced velocity review requires enabled base tracking with the same window.",
          );
        result.push(
          `Projected transfer total exceeds ${amount(cap)} in the tracked ${window}-second window (including this transfer)`,
        );
      } else
        throw new Error("Unsupported or malformed advanced policy condition.");
    }
  }
  if (at !== bytes.length)
    throw new Error("Trailing bytes in advanced policy.");
  return result;
}
