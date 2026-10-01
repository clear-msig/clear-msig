import { reviewAdvancedPolicy } from "./advancedPolicyReview";
import { PublicKey } from "@solana/web3.js";
import { fromHex } from "@/lib/msig/hash";
import { policyCommitmentHex } from "@/lib/policies/onchain";

/** Read-only CSP1/CSP2 interpretation. Unknown extensions never become approval. */
export function reviewStoredProtectionPolicy(
  kind: number,
  hex: string,
  details: string,
): string {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex) || hex.length > 4096)
    throw new Error(
      "New policy bytes are missing or malformed. Approval is blocked.",
    );
  const bytes = fromHex(hex),
    lines = details.split("\n");
  function value(prefix: string) {
    const matches = lines.filter((line) => line.startsWith(prefix + ": "));
    if (matches.length !== 1)
      throw new Error("Missing or ambiguous policy scope.");
    return matches[0].slice(prefix.length + 2);
  }
  if (value("New policy commitment") !== policyCommitmentHex(bytes))
    throw new Error(
      "Stored policy bytes do not match the reviewed new policy commitment.",
    );
  let body = bytes,
    decimals = 9,
    asset = "SOL";
  const output: string[] = [];
  if (kind === 6) {
    if (value("Policy chain kind") !== "0")
      throw new Error(
        "This policy's recipient identities or asset units cannot yet be decoded for review. Approval is blocked.",
      );
    output.push("Scope: Solana native SOL");
  } else if (kind === 16) {
    if (
      bytes.length < 57 ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== "CSP2" ||
      bytes[4] !== 1 ||
      bytes[5] > 18
    )
      throw new Error("Unsupported asset policy scope.");
    decimals = bytes[5];
    asset = value("Asset");
    const mint = new PublicKey(bytes.subarray(6, 38)).toBase58();
    if (
      value("Asset mint") !== mint ||
      value("Decimals") !== String(decimals) ||
      value("Policy scope") !== "SPL token"
    )
      throw new Error(
        "Asset policy identity differs from the canonical action.",
      );
    output.push(
      `Scope: SPL token ${asset}`,
      `Mint: ${mint}`,
      `Decimals: ${decimals}`,
    );
    body = bytes.subarray(38);
  } else throw new Error("Not a protection-policy action.");
  if (
    body.length < 19 ||
    String.fromCharCode(...body.subarray(0, 4)) !== "CSP1"
  )
    throw new Error("Unsupported protection policy encoding.");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const u32 = (at: number) => view.getUint32(at, true),
    u64 = (at: number) => view.getBigUint64(at, true);
  const amount = (raw: bigint) => {
    const scale = 10n ** BigInt(decimals),
      whole = raw / scale,
      fraction = (raw % scale)
        .toString()
        .padStart(decimals, "0")
        .replace(/0+$/, "");
    return `${whole}${fraction ? "." + fraction : ""} ${asset} (${raw} raw units)`;
  };
  const mode = body[4],
    recipients = body[17],
    approvers = body[18];
  if (
    mode > 2 ||
    recipients > 16 ||
    approvers > 16 ||
    19 + (recipients + approvers) * 32 > body.length
  )
    throw new Error("Malformed policy authority or recipient list.");
  const keys = (at: number, count: number) =>
    Array.from({ length: count }, (_, n) =>
      new PublicKey(body.subarray(at + n * 32, at + (n + 1) * 32)).toBase58(),
    );
  const recipientKeys = keys(19, recipients),
    required = keys(19 + recipients * 32, approvers);
  if (mode === 0 && recipients !== 0)
    throw new Error("Ambiguous unused recipient list. Approval is blocked.");
  output.push(
    `Per-transfer maximum: ${u64(5) === 0n ? "No amount cap in this policy" : amount(u64(5))}`,
    `Additional delay after approval and the governance timelock: ${u32(13)} seconds`,
    mode === 0
      ? "Recipients: Any recipient"
      : mode === 1
        ? recipients
          ? "Recipients: Only the following addresses"
          : "Recipients: None allowed (all transfers blocked)"
        : recipients
          ? "Recipients: All except the following addresses"
          : "Recipients: Any recipient (empty blocklist)",
    ...recipientKeys.map((k) => `Recipient: ${k}`),
    required.length
      ? "Additional required approvers:"
      : "Additional required approvers: None",
    ...required.map((k) => `Approver: ${k}`),
  );
  let offset = 19 + (recipients + approvers) * 32;
  const seen = new Set<number>();
  let trackingWindowSeconds: number | undefined;
  let advanced: Uint8Array | undefined;
  while (offset < body.length) {
    if (offset + 3 > body.length)
      throw new Error("Truncated policy extension.");
    const tag = body[offset],
      length = view.getUint16(offset + 1, true);
    offset += 3;
    if (seen.has(tag) || offset + length > body.length)
      throw new Error("Duplicate or truncated policy extension.");
    seen.add(tag);
    if (tag === 1 && length === 12) {
      const cap = u64(offset),
        seconds = u32(offset + 8);
      if (cap > 0n && seconds > 0) trackingWindowSeconds = seconds;
      output.push(
        cap === 0n || seconds === 0
          ? `Transfer total cap: Not enforced (cap ${cap} raw units; window ${seconds} seconds)`
          : `Transfer total cap: ${amount(cap)} per ${seconds}-second window`,
      );
    } else if (tag === 2 && length === 8) {
      const cap = u32(offset),
        seconds = u32(offset + 4);
      output.push(
        cap === 0 || seconds === 0
          ? `Transfer count cap: Not enforced (maximum ${cap}; window ${seconds} seconds)`
          : `Transfer count cap: ${cap} per ${seconds}-second window`,
      );
    } else if (tag === 3 && length === 5) {
      const start = body[offset],
        end = body[offset + 1],
        mask = body[offset + 2],
        storedOffset = view.getInt16(offset + 3, true);
      if (start > 23 || end > 23 || mask > 127 || Math.abs(storedOffset) > 840)
        throw new Error("Invalid allowed-time policy.");
      const signed = -storedOffset;
      const zone = `UTC${signed < 0 ? "-" : "+"}${String(Math.floor(Math.abs(signed) / 60)).padStart(2, "0")}:${String(Math.abs(signed) % 60).padStart(2, "0")}`;
      output.push(
        `Allowed time: ${start === end ? "No hours allowed" : `${String(start).padStart(2, "0")}:00 inclusive to ${String(end).padStart(2, "0")}:00 exclusive${start > end ? " (overnight)" : ""}`} at fixed ${zone}`,
        `Allowed days: ${mask === 0 ? "Every day" : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].filter((_, n) => mask & (1 << n)).join(", ")}`,
      );
    } else if (tag === 4 && length > 0 && length % 44 === 0 && length <= 352) {
      const members = new Set<string>();
      for (let row = offset; row < offset + length; row += 44) {
        const cap = u64(row + 32),
          seconds = u32(row + 40);
        const member = new PublicKey(body.subarray(row, row + 32)).toBase58();
        if (members.has(member))
          throw new Error(
            "Duplicate member allowance identity. Approval is blocked.",
          );
        members.add(member);
        output.push(
          `Allowance for requests proposed by ${member}: ${
            cap === 0n
              ? "All transfers proposed by this member are blocked"
              : seconds === 0
                ? `${amount(cap)} per transfer`
                : `${amount(cap)} per ${seconds}-second window`
          }`,
        );
      }
    } else if (tag === 5 && length > 0) {
      advanced = body.subarray(offset, offset + length);
    } else
      throw new Error(
        "This policy contains an unsupported or malformed rule. Approval is blocked until the rule can be fully reviewed.",
      );
    offset += length;
  }
  if (advanced)
    output.push(
      ...reviewAdvancedPolicy(advanced, amount, trackingWindowSeconds),
    );
  if (!seen.has(1)) output.push("Transfer total cap: None in this policy");
  if (!seen.has(2)) output.push("Transfer count cap: None in this policy");
  if (!seen.has(3))
    output.push("Allowed time: No time restriction in this policy");
  if (!seen.has(4)) output.push("Per-member allowance: None in this policy");
  else
    output.push(
      "Unlisted proposers have no member-specific cap from this rule; other policy rules still apply.",
    );
  if (
    kind === 16 &&
    (u32(13) > 0 || required.length > 0 || seen.has(4) || seen.has(5))
  )
    output.push(
      "Compatibility: recurring-payment execution rejects additional approvers, added delay, member allowances, or advanced rules in this policy.",
    );
  output.push(
    "These rules replace the stored policy; existing wallet governance still applies.",
  );
  return output.join("\n");
}
