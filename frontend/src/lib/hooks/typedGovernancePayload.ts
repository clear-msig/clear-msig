import { fromHex, sha256, toHex } from "@/lib/msig/hash";

const MAX_TARGET_INTENT_INDEX = 255;
const POLICY_COMMITMENT_DOMAIN = "clearsig:policy-engine:v2:policy";
const TYPED_POLICY_DOMAIN = "typed-sol-send-policy-v1";

export function encodeTypedGovernancePayload(
  targetIntentIndex: number,
  newIntentBodyHex: string,
): { bytes: Uint8Array; hex: string } {
  if (
    !Number.isInteger(targetIntentIndex) ||
    targetIntentIndex < 0 ||
    targetIntentIndex > MAX_TARGET_INTENT_INDEX
  ) {
    throw new Error("Governance target intent index is invalid.");
  }
  const body = fromHex(newIntentBodyHex);
  if (body.length === 0) {
    throw new Error("Governance intent body is empty.");
  }
  const bytes = new Uint8Array(body.length + 1);
  bytes[0] = targetIntentIndex;
  bytes.set(body, 1);
  return { bytes, hex: toHex(bytes) };
}

export function decodeTypedGovernancePayload(policyBytesHex: string): {
  targetIntentIndex: number;
  newIntentBodyHex: string;
} {
  const bytes = fromHex(policyBytesHex);
  if (bytes.length < 2) {
    throw new Error("This governance request is missing its committed execution payload.");
  }
  return {
    targetIntentIndex: bytes[0]!,
    newIntentBodyHex: toHex(bytes.subarray(1)),
  };
}

export function typedGovernanceCommitmentHex(payload: Uint8Array): string {
  const domain = new TextEncoder().encode(POLICY_COMMITMENT_DOMAIN);
  const policyDomain = new TextEncoder().encode(TYPED_POLICY_DOMAIN);
  const bytes = new Uint8Array(
    4 + domain.length + 4 + 4 + policyDomain.length + 4 + payload.length,
  );
  let offset = 0;
  offset = writeU32(bytes, offset, domain.length);
  bytes.set(domain, offset);
  offset += domain.length;
  offset = writeU32(bytes, offset, 2);
  offset = writeU32(bytes, offset, policyDomain.length);
  bytes.set(policyDomain, offset);
  offset += policyDomain.length;
  offset = writeU32(bytes, offset, payload.length);
  bytes.set(payload, offset);
  return toHex(sha256(bytes));
}

function writeU32(out: Uint8Array, offset: number, value: number): number {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
  return offset + 4;
}
