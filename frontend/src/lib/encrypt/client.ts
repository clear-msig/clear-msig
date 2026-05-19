// Encrypt - confidential policies abstraction.
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
// 1.  Their TypeScript client lives at `@encrypt.xyz/pre-alpha-solana-client`.
//     Two transports:
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
//     Comparisons, arithmetic, conditional branching - all FHE.
//
// 4.  Pre-alpha disclaimer (verbatim): "There is no real encryption -
//     all data is completely public and stored as plaintext on-chain."
//     The API surface exists; the cryptography hasn't switched on yet.
//
// 5.  Network keys + endpoints aren't published yet - at minimum we'll
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
// Only this file. Replace the pre-alpha mock ciphertext bytes passed
// to `client.createInput(...)` with Encrypt's production WASM FHE
// encryptor + proof, then flip `encryptStatus().live` to `true`.

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

/// What ends up on chain - either real ciphertext (Alpha 1+) or the
/// plaintext bytes verbatim (today). Versioned so a single wallet can
/// hold a mix of bound-pre-alpha and bound-after-Alpha-1 policies
/// during the rollout window.
export interface EncryptedPayload {
  /// Hex-encoded ciphertext bytes. Kept JSON-native because policy
  /// rules are persisted through localStorage; raw Uint8Array values
  /// stringify into object-shaped data that cannot be decoded after
  /// reload.
  ciphertext: string;
  scheme: EncryptScheme;
  /// Set when scheme is `encrypt-fhe-v1` - the gRPC service's
  /// reference back to the stored ciphertext. The on-chain program
  /// dereferences this to pull the encrypted bytes for FHE ops.
  ciphertextIdentifier?: string;
  fheType?: FheType;
}

/// Network configuration. When both `grpcUrl` and
/// `networkEncryptionPublicKey` are set, the frontend calls Encrypt's
/// published pre-alpha gRPC-Web `createInput` endpoint.
export interface NetworkConfig {
  /// gRPC-Web endpoint for the Encrypt service. Likely something like
  /// `https://gateway.encrypt.xyz` once it's live.
  grpcUrl: string | null;
  /// 32-byte network public key the client encrypts inputs against.
  /// Fetched from the gRPC service at startup, cached for the session.
  networkEncryptionPublicKey: Uint8Array | null;
  /// Program authorized to receive these ciphertexts - Clear's program.
  authorizedProgram: Uint8Array;
}

export function getNetworkConfig(): NetworkConfig {
  return {
    grpcUrl: process.env.NEXT_PUBLIC_ENCRYPT_GRPC_URL ?? null,
    networkEncryptionPublicKey: parseHexBytes(
      process.env.NEXT_PUBLIC_ENCRYPT_NETWORK_KEY_HEX,
    ),
    authorizedProgram: CLEAR_WALLET_PROGRAM_ID.toBytes(),
  };
}

function parseHexBytes(hex: string | undefined): Uint8Array | null {
  if (!hex) return null;
  const normalized = hex.trim().replace(/^0x/i, "");
  if (normalized.length === 0) return null;
  return hexToBytes(normalized);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();
  if (normalized.length % 2 !== 0) {
    throw new Error("invalid ciphertext hex length");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) {
      throw new Error("invalid ciphertext hex");
    }
    out[i] = byte;
  }
  return out;
}

function ciphertextToBytes(ciphertext: unknown): Uint8Array {
  if (ciphertext instanceof Uint8Array) return ciphertext;
  if (typeof ciphertext === "string") return hexToBytes(ciphertext);
  // Back-compat for rules saved before EncryptedPayload became
  // JSON-native. JSON.stringify(Uint8Array) produces {"0":123,...}.
  if (ciphertext && typeof ciphertext === "object") {
    const values = Object.entries(ciphertext as Record<string, unknown>)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, value]) => Number(value));
    if (values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      return new Uint8Array(values);
    }
  }
  throw new Error("unsupported ciphertext payload encoding");
}

function fheTypeCode(fheType: FheType): number {
  // Encrypt pre-alpha's public TS client takes numeric fheType
  // values. The exact enum is not exported by the package; EUint64
  // is documented as 4 in grpc-web.ts. Keep the same contiguous
  // layout used by the current pre-alpha examples.
  switch (fheType) {
    case "ebool":
      return 0;
    case "euint8":
      return 1;
    case "euint16":
      return 2;
    case "euint32":
      return 3;
    case "euint64":
      return 4;
    case "euint128":
      return 5;
    case "ebytes":
      return 6;
  }
}

function identifierToString(id: Uint8Array | string): string {
  if (typeof id === "string") return id;
  return "enc_" + bytesToHex(id);
}

function plaintextNumber(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  if (bytes.length === 1) return BigInt(bytes[0]);
  const text = new TextDecoder().decode(bytes).trim();
  if (/^\d+$/.test(text)) return BigInt(text);
  let out = 0n;
  for (let i = 0; i < bytes.length; i++) {
    out |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  return out;
}

async function createInputWithEncryptNetwork(
  cfg: NetworkConfig,
  inputs: ReadonlyArray<{ plaintext: Uint8Array; fheType: FheType }>,
): Promise<string[] | null> {
  if (!cfg.grpcUrl || !cfg.networkEncryptionPublicKey) return null;
  try {
    const mod = (await import(
      "@encrypt.xyz/pre-alpha-solana-client/grpc-web"
    )) as {
      createEncryptWebClient: (baseUrl: string) => {
        createInput: (params: {
          chain: unknown;
          inputs: Array<{ ciphertextBytes: Uint8Array; fheType: number }>;
          authorized: Uint8Array;
          networkEncryptionPublicKey: Uint8Array;
        }) => Promise<Array<Uint8Array | string>>;
      };
      Chain: { SOLANA?: unknown; Solana?: unknown; solana?: unknown };
      encryptValue: (value: number | bigint, fheType: number) => Uint8Array;
    };
    const chain =
      mod.Chain.SOLANA ?? mod.Chain.Solana ?? mod.Chain.solana ?? 0;
    const client = mod.createEncryptWebClient(cfg.grpcUrl);
    const identifiers = await client.createInput({
      chain,
      inputs: inputs.map((i) => ({
        // Pre-alpha client still accepts mock ciphertext bytes. When
        // Encrypt ships the WASM FHE encryptor, this is the one spot
        // that swaps plaintext bytes for real ciphertext+proof.
        ciphertextBytes:
          i.fheType === "ebytes"
            ? i.plaintext
            : mod.encryptValue(plaintextNumber(i.plaintext), fheTypeCode(i.fheType)),
        fheType: fheTypeCode(i.fheType),
      })),
      authorized: cfg.authorizedProgram,
      networkEncryptionPublicKey: cfg.networkEncryptionPublicKey,
    });
    return identifiers.map(identifierToString);
  } catch (err) {
    console.warn("[encrypt] network createInput failed; using local stub", err);
    return null;
  }
}

/// Encrypt a policy field. Routes through Encrypt's pre-alpha
/// gRPC-Web client when configured, otherwise the local fallback.
/// The returned `ciphertextIdentifier` matches the service shape so
/// call sites and persistence layers don't change when real FHE
/// ciphertext generation replaces the pre-alpha mock bytes.
export async function encryptPolicy(
  plaintext: Uint8Array,
  options?: { fheType?: FheType },
): Promise<EncryptedPayload> {
  const fheType = options?.fheType ?? "ebytes";
  const cfg = getNetworkConfig();
  const networkIds = await createInputWithEncryptNetwork(cfg, [
    { plaintext, fheType },
  ]);
  const ciphertextIdentifiers =
    networkIds ??
    (
      await localEncryptClient.createInput({
        chain: "solana",
        inputs: [{ ciphertextBytes: plaintext, fheType }],
        authorized: cfg.authorizedProgram,
        networkEncryptionPublicKey: cfg.networkEncryptionPublicKey,
      })
    ).ciphertextIdentifiers;
  return {
    // Pre-alpha: ciphertext bytes are still the plaintext bytes - the
    // real cryptography hasn't switched on. The identifier IS real
    // (locally-deterministic SHA-256), so any persistence keyed off
    // it works the same way at Alpha 1.
    ciphertext: bytesToHex(plaintext),
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
  const normalized = inputs.map((i) => ({
    plaintext: i.plaintext,
    fheType: i.fheType ?? "ebytes",
  }));
  const networkIds = await createInputWithEncryptNetwork(cfg, normalized);
  const ciphertextIdentifiers =
    networkIds ??
    (
      await localEncryptClient.createInput({
        chain: "solana",
        inputs: normalized.map((i) => ({
          ciphertextBytes: i.plaintext,
          fheType: i.fheType,
        })),
        authorized: cfg.authorizedProgram,
        networkEncryptionPublicKey: cfg.networkEncryptionPublicKey,
      })
    ).ciphertextIdentifiers;
  return inputs.map((i, idx) => ({
    ciphertext: bytesToHex(i.plaintext),
    scheme: "passthrough-v1",
    ciphertextIdentifier: ciphertextIdentifiers[idx],
    fheType: i.fheType ?? "ebytes",
  }));
}

/// Aggregate count of locally-stored ciphertexts. Surfaced in the
/// /privacy explainer so users see real evidence the encryption
/// surface is flowing - even if today's pre-alpha doesn't yet apply
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
      return ciphertextToBytes(payload.ciphertext);
    case "encrypt-fhe-v1":
      throw new Error(
        "encrypt-fhe-v1 decrypt not implemented - pending Encrypt SDK npm release",
      );
  }
}

export interface EncryptStatus {
  /// True when Encrypt's network is live and policies travel as real
  /// FHE ciphertext on chain. Today: false (pre-alpha; the SDK's own
  /// disclaimer is "no real encryption, data is plaintext on chain").
  /// Consumers gate "Encrypted" badging and "Encryption active"
  /// status text on this; flip flips the UI in one swap.
  live: boolean;
  /// True when the integration code path is in place: every policy
  /// mutation routes through the Encrypt surface, ciphertext IDs
  /// flow frontend → backend → CLI, the swap to real FHE only
  /// touches this module. Today: true. Distinct from `live` so the
  /// UI can say "ready, not yet active" honestly.
  wired: boolean;
  /// True when the browser has enough configuration to call
  /// Encrypt's published pre-alpha gRPC-Web createInput endpoint.
  networkConfigured: boolean;
  scheme: EncryptScheme;
  /// User-facing one-liner about the current state.
  description: string;
  /// Where to read more.
  learnMoreHref: string;
}

export function encryptStatus(): EncryptStatus {
  // The split between `live` and `wired` exists because we used to
  // overload `live = true` to mean "the integration is wired,"
  // which leaked through to chips reading "Encrypted" / "Private
  // list" before the cryptography existed. Honest pre-alpha
  // framing: the FRONTEND wire path is real (this module). Two
  // pieces still need work for "switch on" to be more than a flag:
  //
  //   1. CLI today logs `policy_ciphertexts` rather than threading
  //      them into the on-chain instruction. (cli/src/commands/intent.rs)
  //   2. The Solana program has no FHE-aware handlers
  //      (`#[encrypt_fn]`, `EUint*`). Approval / threshold checks
  //      need to operate on encrypted refs, not plaintext.
  //
  // When Encrypt ships their npm SDK and Solana FHE crate, the
  // frontend swap is one file; the CLI + program work is the bulk
  // of the lift. /SECURITY.md tracks this honestly.
  const networkConfigured = Boolean(
    process.env.NEXT_PUBLIC_ENCRYPT_GRPC_URL &&
      process.env.NEXT_PUBLIC_ENCRYPT_NETWORK_KEY_HEX,
  );
  return {
    live: false,
    wired: true,
    networkConfigured,
    scheme: "passthrough-v1",
    description:
      networkConfigured
        ? "The frontend submits policy inputs to Encrypt's pre-alpha gRPC-Web createInput endpoint and forwards the returned ciphertext identifiers. CLI and on-chain program still need FHE-aware state before policy enforcement is private on chain."
        : "The frontend routes every policy change through the Encrypt surface today using a local pre-alpha stub. Set NEXT_PUBLIC_ENCRYPT_GRPC_URL and NEXT_PUBLIC_ENCRYPT_NETWORK_KEY_HEX to submit inputs to Encrypt's pre-alpha service.",
    learnMoreHref: "/privacy",
  };
}
