// Vendored from @fesal-packages/ikavery-core / packages/core/src/passkey/spki.ts
// (BSD-3-Clause). The published `ikavery-solana-sdk` declares a `workspace:*`
// dependency on `ikavery-core` which npm cannot resolve, so we vendor the
// single helper the Solana SDK actually consumes (`derSigToCompactRaw64`)
// rather than fight the upstream packaging issue.
//
// Source:
//   https://github.com/Iamknownasfesal/ikavery
//   packages/core/src/passkey/spki.ts
//
// If the upstream republishes with resolved dep specs, swap this file for
// `import { derSigToCompactRaw64 } from "@fesal-packages/ikavery-core"` in
// `passkey/assertion.ts` and delete this file.

import { p256 } from "@noble/curves/p256";

/**
 * Convert an ASN.1 DER ECDSA signature to the 64-byte `r || s` form expected
 * by the on-chain secp256r1 precompile. Delegates to `@noble/curves`.
 *
 * Normalizes to low-S form. WebAuthn authenticators (notably Apple's)
 * routinely emit high-S signatures; without this normalization, ~half of
 * all assertions would fail verification.
 */
export function derSigToCompactRaw64(der: Uint8Array): Uint8Array {
  const sig = p256.Signature.fromDER(der).normalizeS();
  return sig.toCompactRawBytes();
}
