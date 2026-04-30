// Encrypt — confidential policies abstraction.
//
// Per the locked retail-pivot spec: every Clear policy (signer list,
// thresholds, allowances, recipient allowlists) will be encrypted
// on-chain via Encrypt's FHE primitives. Encrypt is pre-alpha; their
// docs say "no real encryption yet, all data is plaintext." We accepted
// shipping the UX + marketing now with a pass-through stub here.
//
// When Encrypt's SDK ships, ONLY this module changes — call sites stay
// identical, so policies that exist today transition to ciphertext
// without any UX or app-state migration.
//
// Versioning: every payload carries a `scheme` tag so we can tell
// pass-through bytes from real ciphertext during the rollout window.

export type EncryptScheme = "passthrough-v1" | "encrypt-fhe-v1";

export interface EncryptedPayload {
  /// The ciphertext bytes. In `passthrough-v1` these are the
  /// plaintext bytes verbatim — Encrypt's pre-alpha contract.
  ciphertext: Uint8Array;
  scheme: EncryptScheme;
}

/// Encrypt a policy blob (signer list, thresholds, etc.) for on-chain
/// storage. Today: pass-through. When `encrypt-fhe-v1` lands, the
/// implementation routes through Encrypt's FHE keygen + encryption.
export async function encryptPolicy(
  plaintext: Uint8Array,
): Promise<EncryptedPayload> {
  return { ciphertext: plaintext, scheme: "passthrough-v1" };
}

/// Decrypt a policy blob. Caller hands us the on-chain bytes plus the
/// scheme tag we stored alongside; we route to the right impl.
export async function decryptPolicy(
  payload: EncryptedPayload,
): Promise<Uint8Array> {
  switch (payload.scheme) {
    case "passthrough-v1":
      return payload.ciphertext;
    case "encrypt-fhe-v1":
      throw new Error(
        "encrypt-fhe-v1 decrypt not implemented — Encrypt SDK pending",
      );
  }
}

export interface EncryptStatus {
  /// True when Encrypt's network is live and policies are real
  /// ciphertext. Today: false.
  live: boolean;
  scheme: EncryptScheme;
  /// User-facing one-liner about the current state.
  description: string;
  /// Where to read more.
  learnMoreHref: string;
}

export function encryptStatus(): EncryptStatus {
  return {
    live: false,
    scheme: "passthrough-v1",
    description:
      "Encrypt's network is rolling out. Your wallet behaves the same way it will once policies are encrypted, but in this preview the policy bytes aren't ciphertext yet.",
    learnMoreHref: "/privacy",
  };
}
