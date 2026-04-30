// Encrypt — confidential policies abstraction.
//
// Per the locked retail-pivot spec: every Clear policy (signer list,
// thresholds, allowances, recipient allowlists) ships through the
// Encrypt FHE network so the on-chain bytes are ciphertext, while
// Clear's program (with #[encrypt_fn]-decorated handlers) still
// computes approvals, threshold checks, and allowance arithmetic
// directly on the encrypted data.
//
// ── What we learned from docs.encrypt.xyz / dwallet-labs/encrypt-pre-alpha
//
// 1.  Their TypeScript client lives at `@encrypt.xyz/pre-alpha-solana-client`
//     (not yet on npm — only in their git repo). Two transports:
//       - `src/grpc.ts`     (Node)
//       - `src/grpc-web.ts` (browser, what we'd want)
//
// 2.  Off-chain client flow (paraphrased from their README):
//
//       const { ciphertextIdentifiers } = await encrypt.createInput({
//         chain: Chain.Solana,
//         inputs: [{ ciphertextBytes: Buffer.from(...), fheType: 4 }],
//         authorized: programId.toBytes(),
//         networkEncryptionPublicKey: networkKey,
//       });
//
//     The plaintext is encrypted *client-side* against the network's
//     public key. The gRPC service stores the ciphertext and returns
//     identifiers. Those identifiers (not the raw bytes) are what get
//     embedded in the on-chain transaction.
//
// 3.  On-chain program then operates on the encrypted refs. Example
//     from their README:
//
//       #[encrypt_fn]
//       fn transfer(from: EUint64, to: EUint64, amount: EUint64)
//         -> (EUint64, EUint64) { … }
//
//     Comparisons, arithmetic, conditional branching — all FHE.
//
// 4.  Pre-alpha disclaimer (verbatim): "There is no real encryption —
//     all data is completely public and stored as plaintext on-chain."
//     The API surface exists; the cryptography hasn't switched on yet.
//
// 5.  Network keys + endpoints aren't published yet — at minimum we'll
//     need the gRPC gateway URL and a way to fetch the current
//     `networkEncryptionPublicKey`. Those plug into the config below
//     when Alpha 1 lands.
//
// ── What this module does today
//
// Pass-through. Same call sites the future implementation will use
// (`encryptPolicy(plaintext, ctx)` → `EncryptedPayload`,
// `decryptPolicy(payload)` → bytes), so when the swap happens the
// rest of the app doesn't change.
//
// ── What changes at swap time
//
// Only this file. Add the `@encrypt.xyz/pre-alpha-solana-client`
// dependency (when it ships to npm), instantiate a gRPC-Web transport
// against `getNetworkConfig().grpcUrl`, fetch the network key, route
// `encryptPolicy` through `client.createInput(...)`. Flip
// `encryptStatus().live` to `true`.

import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { localEncryptClient } from "@/lib/encrypt/local-client";

export type EncryptScheme = "passthrough-v1" | "encrypt-fhe-v1";

/// Mirrors Encrypt's `FheType` enum. We only need the integer/byte
/// types for policy fields (signer list, thresholds, allowances).
/// Numeric values match their pre-alpha schema.
export type FheType =
  | "ebool"
  | "euint8"
  | "euint16"
  | "euint32"
  | "euint64"
  | "euint128"
  | "ebytes";

/// Raw input for the network's `createInput` call. One entry per
/// policy field that should land on chain encrypted.
export interface EncryptInput {
  plaintext: Uint8Array;
  fheType: FheType;
}

/// What ends up on chain — either real ciphertext (Alpha 1+) or the
/// plaintext bytes verbatim (today). Versioned so a single wallet can
/// hold a mix of bound-pre-alpha and bound-after-Alpha-1 policies
/// during the rollout window.
export interface EncryptedPayload {
  ciphertext: Uint8Array;
  scheme: EncryptScheme;
  /// Set when scheme is `encrypt-fhe-v1` — the gRPC service's
  /// reference back to the stored ciphertext. The on-chain program
  /// dereferences this to pull the encrypted bytes for FHE ops.
  ciphertextIdentifier?: string;
  fheType?: FheType;
}

/// Network configuration we'll need at swap time. None of these
/// fields are populated today — they'll come from env when Encrypt
/// publishes endpoints + ships their npm package.
export interface NetworkConfig {
  /// gRPC-Web endpoint for the Encrypt service. Likely something like
  /// `https://gateway.encrypt.xyz` once it's live.
  grpcUrl: string | null;
  /// 32-byte network public key the client encrypts inputs against.
  /// Fetched from the gRPC service at startup, cached for the session.
  networkEncryptionPublicKey: Uint8Array | null;
  /// Program authorized to receive these ciphertexts — Clear's program.
  authorizedProgram: Uint8Array;
}

export function getNetworkConfig(): NetworkConfig {
  return {
    grpcUrl: process.env.NEXT_PUBLIC_ENCRYPT_GRPC_URL ?? null,
    networkEncryptionPublicKey: null,
    authorizedProgram: CLEAR_WALLET_PROGRAM_ID.toBytes(),
  };
}

/// Encrypt a policy field. Routes through the active client —
/// `LocalEncryptClient` today, swap to the real gRPC client when
/// `@encrypt.xyz/pre-alpha-solana-client` ships. The returned
/// `ciphertextIdentifier` matches the real service's shape so call
/// sites and persistence layers don't change at swap time.
export async function encryptPolicy(
  plaintext: Uint8Array,
  options?: { fheType?: FheType },
): Promise<EncryptedPayload> {
  const fheType = options?.fheType ?? "ebytes";
  const cfg = getNetworkConfig();
  const { ciphertextIdentifiers } = await localEncryptClient.createInput({
    chain: "solana",
    inputs: [{ ciphertextBytes: plaintext, fheType }],
    authorized: cfg.authorizedProgram,
    networkEncryptionPublicKey: cfg.networkEncryptionPublicKey,
  });
  return {
    // Pre-alpha: ciphertext bytes are still the plaintext bytes — the
    // real cryptography hasn't switched on. The identifier IS real
    // (locally-deterministic SHA-256), so any persistence keyed off
    // it works the same way at Alpha 1.
    ciphertext: plaintext,
    scheme: "passthrough-v1",
    ciphertextIdentifier: ciphertextIdentifiers[0],
    fheType,
  };
}

/// Encrypt many fields in one round-trip. Useful for create-wallet /
/// add-intent / update-approvers, where proposers + approvers + the
/// threshold byte all become separate `EUint*` / `EBytes` inputs to
/// the same intent. Returns identifiers in the same order as the
/// inputs argument.
export async function encryptPolicyBatch(
  inputs: ReadonlyArray<{ plaintext: Uint8Array; fheType?: FheType }>,
): Promise<EncryptedPayload[]> {
  const cfg = getNetworkConfig();
  const { ciphertextIdentifiers } = await localEncryptClient.createInput({
    chain: "solana",
    inputs: inputs.map((i) => ({
      ciphertextBytes: i.plaintext,
      fheType: i.fheType ?? "ebytes",
    })),
    authorized: cfg.authorizedProgram,
    networkEncryptionPublicKey: cfg.networkEncryptionPublicKey,
  });
  return inputs.map((i, idx) => ({
    ciphertext: i.plaintext,
    scheme: "passthrough-v1",
    ciphertextIdentifier: ciphertextIdentifiers[idx],
    fheType: i.fheType ?? "ebytes",
  }));
}

/// Aggregate count of locally-stored ciphertexts. Surfaced in the
/// /privacy explainer so users see real evidence the encryption
/// surface is flowing — even if today's pre-alpha doesn't yet apply
/// the FHE primitives.
export function localCiphertextCount(): number {
  return localEncryptClient.list().length;
}

/// Decrypt for read paths. Plaintext-only today. When Alpha 1 lands,
/// the off-chain reader fetches the ciphertext via the identifier and
/// decrypts using the user's secret share (Encrypt manages this).
export async function decryptPolicy(
  payload: EncryptedPayload,
): Promise<Uint8Array> {
  switch (payload.scheme) {
    case "passthrough-v1":
      return payload.ciphertext;
    case "encrypt-fhe-v1":
      throw new Error(
        "encrypt-fhe-v1 decrypt not implemented — pending Encrypt SDK npm release",
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
