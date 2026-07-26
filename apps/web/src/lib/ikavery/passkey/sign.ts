// Sign-time passkey driver — runs `navigator.credentials.get` with no
// `allowCredentials` so the OS shows a passkey picker, then recovers
// the credential's public key from the ECDSA signature itself.
//
// Why ECDSA recovery instead of looking up by credentialId:
//   The on-chain Recovery roster stores members by 33-byte compressed
//   P-256 pubkey, not by credentialId. At enrollment we don't persist
//   the credentialId locally (passkeys are device-bound; the OS
//   keychain owns that mapping), so we can't use `allowCredentials` to
//   target a specific member. ECDSA pubkey recovery yields up to two
//   candidate public keys per signature; one is mathematical garbage
//   and the other is the real signer. The caller compares against the
//   on-chain roster to pick the match.
//
// Returns the same shape `runWebAuthnAssertion` does — precompileIx,
// credential, raw clientDataJson — plus the two candidate pubkeys so
// the caller can match against on-chain members.

import { sha256 } from "@noble/hashes/sha256";
import { p256 } from "@noble/curves/p256";
import type { TransactionInstruction } from "@solana/web3.js";

import { SCHEME_WEBAUTHN } from "../constants";
import type { AuthCredential } from "../ix/types";
import { derSigToCompactRaw64 } from "../_core_helpers";
import { buildSecp256r1VerifyIx } from "./precompile";

export interface RunSignParams {
  /** 32-byte per-op challenge built via the `challenges` module. */
  challenge: Uint8Array;
  /**
   * Optional RP id. Defaults to the browser-derived value
   * (`window.location.hostname`); pass an explicit string when running
   * across subdomains so the picker shows credentials enrolled at the
   * canonical RP id.
   */
  rpId?: string;
  /** Forwarded to `navigator.credentials.get` to allow async cancellation. */
  signal?: AbortSignal;
}

export interface RunSignResult {
  /** The two candidate compressed P-256 pubkeys (33 bytes each).
   *  Exactly one matches the signer; the caller picks by checking against
   *  the on-chain roster. */
  candidatePubkeys: Uint8Array[];
  /** Credential id from `navigator.credentials.get`. Useful for telemetry. */
  credentialId: Uint8Array;
  /** Raw clientDataJSON. */
  clientDataJson: Uint8Array;
  /** Raw authenticatorData. */
  authenticatorData: Uint8Array;
  /**
   * Build the precompile ix + AuthCredential for a chosen pubkey. The
   * caller passes whichever of `candidatePubkeys` matched the on-chain
   * member; both candidates produce a valid precompile (the on-chain
   * verifier checks the sig against the pubkey we provide), so this is
   * safe to call with either.
   */
  build: (chosenPubkey: Uint8Array) => {
    precompileIx: TransactionInstruction;
    credential: AuthCredential;
  };
}

/**
 * Run a passkey assertion for `challenge` and return the candidate
 * pubkeys + a builder for the precompile ix. The caller must pick the
 * pubkey that matches a known on-chain member, then call `build` to
 * compose the propose / approve credential bundle.
 *
 * Browser-only — throws if `navigator.credentials.get` is unavailable.
 */
export async function runPasskeySign(
  params: RunSignParams,
): Promise<RunSignResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.credentials ||
    typeof navigator.credentials.get !== "function"
  ) {
    throw new Error(
      "WebAuthn is not available — passkey sign requires a browser with PublicKeyCredential support.",
    );
  }
  if (params.challenge.length !== 32) {
    throw new Error(
      `Sign challenge must be 32 bytes, got ${params.challenge.length}`,
    );
  }

  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(params.challenge),
      // Empty allowCredentials lets the OS show every passkey bound to
      // this RP. The user picks; we then use ECDSA recovery to figure
      // out which on-chain member they signed as.
      allowCredentials: [],
      rpId: params.rpId,
      userVerification: "required",
      timeout: 60_000,
    },
    signal: params.signal,
  })) as PublicKeyCredential | null;
  if (!cred) {
    throw new Error("Passkey selection was cancelled.");
  }

  const response = cred.response as AuthenticatorAssertionResponse;
  const authenticatorData = new Uint8Array(response.authenticatorData);
  const clientDataJson = new Uint8Array(response.clientDataJSON);
  const derSignature = new Uint8Array(response.signature);
  const credentialId = new Uint8Array(cred.rawId);

  // The signed payload is `authenticatorData || sha256(clientDataJSON)`
  // and the signature is over `sha256(payload)` (P-256 ECDSA).
  const cdHash = sha256(clientDataJson);
  const signedMessage = new Uint8Array(authenticatorData.length + cdHash.length);
  signedMessage.set(authenticatorData, 0);
  signedMessage.set(cdHash, authenticatorData.length);
  const msgHash = sha256(signedMessage);

  const rawSig = derSigToCompactRaw64(derSignature);
  const sig = p256.Signature.fromCompact(rawSig);

  // Try both recovery bits. One yields the correct pubkey; the other
  // yields garbage that the on-chain roster won't contain.
  const candidates: Uint8Array[] = [];
  for (const recBit of [0, 1] as const) {
    try {
      const point = sig.addRecoveryBit(recBit).recoverPublicKey(msgHash);
      candidates.push(point.toRawBytes(true));
    } catch {
      /* invalid recovery bit for this signature — skip */
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      "Failed to recover any candidate public key from the assertion.",
    );
  }

  return {
    candidatePubkeys: candidates,
    credentialId,
    clientDataJson,
    authenticatorData,
    build(chosenPubkey: Uint8Array) {
      if (chosenPubkey.length !== 33) {
        throw new Error(
          `chosen pubkey must be 33-byte compressed P-256, got ${chosenPubkey.length}`,
        );
      }
      const precompileIx = buildSecp256r1VerifyIx({
        signature: rawSig,
        publicKey: chosenPubkey,
        message: signedMessage,
      });
      const credential: AuthCredential = {
        scheme: SCHEME_WEBAUTHN,
        pubkey: chosenPubkey,
        clientDataJson,
      };
      return { precompileIx, credential };
    },
  };
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength &&
    view.buffer instanceof ArrayBuffer
  ) {
    return view.buffer;
  }
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}
