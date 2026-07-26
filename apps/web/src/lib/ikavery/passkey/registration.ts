/**
 * WebAuthn registration driver - runs `navigator.credentials.create` to
 * enroll a new passkey on this device, then extracts the data we need
 * to add it to a Recovery's roster:
 *
 *   - `credentialId`  - opaque blob the assertion driver later
 *                       references via `allowCredentials`.
 *   - `publicKey`     - 33-byte compressed P-256 pubkey, the form the
 *                       on-chain `auth/webauthn.rs` expects (matches
 *                       the secp256r1 precompile's input shape).
 *
 * The COSE_Key parsing is short - we only need to handle the EC2 / P-256
 * variant the browser produces when we ask for ES256 (algorithm = -7).
 *
 * Browser-only - throws if `navigator.credentials.create` is unavailable.
 */

const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_EC2_CRV = -1;
const COSE_EC2_X = -2;
const COSE_EC2_Y = -3;

const KTY_EC2 = 2;
const ALG_ES256 = -7;
// RS256 (-257) is listed as a fallback in pubKeyCredParams so Chromium
// stops warning about "missing default algorithm identifiers". The
// on-chain side only accepts P-256 (secp256r1) credentials, so the
// extraction path below rejects an RS256 enrollment with a clean error
// rather than silently storing an unusable member.
const ALG_RS256 = -257;
const CRV_P256 = 1;

export interface RegistrationParams {
  /** Display name shown in the OS / browser prompt. e.g. "Treasury vault". */
  rpName: string;
  /** Stable id the credential will be bound to. Default: window.location.hostname. */
  rpId?: string;
  /** User handle that survives across sessions - pairs with credentialId on assertion. */
  userId: Uint8Array;
  /** Display name for the user. e.g. "Treasury vault". Shown in the prompt. */
  userName: string;
  /** Visible label. e.g. "Treasury vault - primary device". */
  userDisplayName?: string;
  /** Per-create challenge (32 bytes). Browser embeds this in the attestation;
   *  we don't verify on chain (registration ≠ assertion) but it must be present. */
  challenge: Uint8Array;
  /** "platform" for built-in TPM/Touch ID, "cross-platform" for security keys.
   *  Omit to let the user pick. */
  authenticatorAttachment?: "platform" | "cross-platform";
  /** Forwarded to `navigator.credentials.create` to allow async cancellation. */
  signal?: AbortSignal;
}

export interface RegistrationResult {
  /** Credential id for `allowCredentials` at sign time. */
  credentialId: Uint8Array;
  /** Compressed 33-byte P-256 pubkey (`0x02|0x03 || x32`). */
  publicKey: Uint8Array;
  /** Raw clientDataJSON, useful for debugging. */
  clientDataJson: Uint8Array;
  /** Raw attestationObject, kept in case we want server-side attestation later. */
  attestationObject: Uint8Array;
}

export async function registerPasskey(
  params: RegistrationParams,
): Promise<RegistrationResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.credentials ||
    typeof navigator.credentials.create !== "function"
  ) {
    // The browser exposes `navigator.credentials.create` only in a
    // secure context (HTTPS or localhost) AND a top-level browsing
    // context (no embedded webview / sandboxed iframe). The most
    // common real-world cause is a non-HTTPS visit (e.g. mobile
    // testing on http://192.168.x.x). Tell the user the likely fix
    // instead of just "not available".
    const isInsecure =
      typeof window !== "undefined" &&
      typeof window.isSecureContext === "boolean" &&
      !window.isSecureContext;
    throw new Error(
      isInsecure
        ? "Passkeys need HTTPS. Reload over https:// (or localhost) and try again."
        : "Your browser doesn't expose passkey support on this page. Try Chrome / Safari / Edge in a normal tab — webview-embedded browsers (Twitter, Instagram, in-app) often disable WebAuthn.",
    );
  }
  if (params.challenge.length !== 32) {
    throw new Error(
      `Registration challenge must be 32 bytes, got ${params.challenge.length}`,
    );
  }

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: toArrayBuffer(params.challenge),
      rp: {
        name: params.rpName,
        id: params.rpId,
      },
      user: {
        id: toArrayBuffer(params.userId),
        name: params.userName,
        displayName: params.userDisplayName ?? params.userName,
      },
      // ES256 first so authenticators that support both pick it. RS256
      // is a fallback that exists only to silence Chromium's
      // "missing default algorithm identifiers" warning — we'll reject
      // RS256 at extraction time below.
      pubKeyCredParams: [
        { type: "public-key", alg: ALG_ES256 },
        { type: "public-key", alg: ALG_RS256 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: params.authenticatorAttachment,
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
    },
    signal: params.signal,
  })) as PublicKeyCredential | null;
  if (!cred) {
    throw new Error("Passkey enrollment was cancelled.");
  }

  const response = cred.response as AuthenticatorAttestationResponse;
  const credentialId = new Uint8Array(cred.rawId);
  const clientDataJson = new Uint8Array(response.clientDataJSON);
  const attestationObject = new Uint8Array(response.attestationObject);

  // The cleanest path to the P-256 pubkey is the spec helper
  // getPublicKey(), which returns the SubjectPublicKeyInfo (SPKI). We
  // strip the SPKI header to recover the uncompressed 65-byte (0x04|x32|y32)
  // form, then compress to 33 bytes (parity || x32). Fall back to manual
  // CBOR parse of attestationObject when getPublicKey is unavailable
  // (older browsers).
  let publicKey: Uint8Array | null = null;
  const responseAny = response as AuthenticatorAttestationResponse & {
    getPublicKey?: () => ArrayBuffer | null;
  };
  if (typeof responseAny.getPublicKey === "function") {
    const raw = responseAny.getPublicKey();
    if (raw) {
      publicKey = compressFromSpki(new Uint8Array(raw));
    }
  }
  if (!publicKey) {
    publicKey = compressFromAttestationObject(attestationObject);
  }
  if (!publicKey || publicKey.length !== 33) {
    throw new Error(
      "This authenticator returned a non-P-256 key (likely RSA). The vault only " +
        "accepts ES256 / P-256 passkeys today. Try a different authenticator " +
        "(Touch ID, modern Windows Hello, YubiKey FIDO2).",
    );
  }

  return {
    credentialId,
    publicKey,
    clientDataJson,
    attestationObject,
  };
}

// ---- helpers --------------------------------------------------------

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  // structuredClone keeps the original Uint8Array intact (don't pass
  // `view.buffer` directly - Node's webcrypto may have a SharedArrayBuffer).
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

/**
 * Strip the SubjectPublicKeyInfo header from a P-256 SPKI to recover the
 * uncompressed 65-byte (0x04 || x32 || y32) point, then compress to 33.
 *
 * The SPKI's last 65 bytes are always the uncompressed point for P-256
 * regardless of the OID prefix length. Defensive but minimal.
 */
function compressFromSpki(spki: Uint8Array): Uint8Array | null {
  if (spki.length < 65) return null;
  const point = spki.slice(spki.length - 65);
  if (point[0] !== 0x04) return null;
  const x = point.slice(1, 33);
  const y = point.slice(33, 65);
  const lastY = y[y.length - 1] ?? 0;
  const out = new Uint8Array(33);
  out[0] = (lastY & 1) === 0 ? 0x02 : 0x03;
  out.set(x, 1);
  return out;
}

/**
 * Fallback path: parse the attestationObject CBOR map, walk
 * authData → COSE_Key, return compressed P-256 pubkey.
 *
 * authData layout: rpIdHash(32) | flags(1) | signCount(4) | aaguid(16) |
 *   credentialIdLength(2) | credentialId(N) | credentialPublicKey(COSE)
 *
 * We only handle the COSE_Key shape `{1: 2, 3: -7, -1: 1, -2: <x>, -3: <y>}`
 * (EC2 / ES256 / P-256). That's the only thing we requested via
 * pubKeyCredParams.
 */
function compressFromAttestationObject(
  attestationObject: Uint8Array,
): Uint8Array | null {
  const parsed = decodeCbor(attestationObject);
  if (!parsed || typeof parsed !== "object") return null;
  const authData = (parsed as { authData?: Uint8Array }).authData;
  if (!authData || authData.length < 55) return null;

  // Skip rpIdHash(32) + flags(1) + signCount(4) = 37
  let off = 37;
  // attestedCredentialData starts here: aaguid(16) + credIdLen(2) +
  // credId(N) + credentialPublicKey
  off += 16; // aaguid
  if (off + 2 > authData.length) return null;
  const credIdLen = (authData[off]! << 8) | authData[off + 1]!;
  off += 2 + credIdLen;
  if (off >= authData.length) return null;

  const cosePublicKey = decodeCbor(authData.slice(off));
  if (!cosePublicKey || typeof cosePublicKey !== "object") return null;
  const cose = cosePublicKey as Record<number, unknown>;
  if (
    cose[COSE_KTY] !== KTY_EC2 ||
    cose[COSE_ALG] !== ALG_ES256 ||
    cose[COSE_EC2_CRV] !== CRV_P256
  ) {
    return null;
  }
  const x = cose[COSE_EC2_X];
  const y = cose[COSE_EC2_Y];
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) return null;
  if (x.length !== 32 || y.length !== 32) return null;
  const lastY = y[y.length - 1] ?? 0;
  const out = new Uint8Array(33);
  out[0] = (lastY & 1) === 0 ? 0x02 : 0x03;
  out.set(x, 1);
  return out;
}

// ---- minimal CBOR decoder ------------------------------------------
//
// Just enough to parse the attestationObject map + the COSE_Key map.
// Handles unsigned/negative ints, byte strings, text strings, arrays,
// and maps. No floats, no tags, no chunked indef streams (the browser
// never emits them here).

function decodeCbor(buf: Uint8Array): unknown {
  const cursor = { off: 0 };
  return readItem(buf, cursor);
}

function readItem(buf: Uint8Array, cursor: { off: number }): unknown {
  if (cursor.off >= buf.length) {
    throw new Error("CBOR underflow");
  }
  const initial = buf[cursor.off]!;
  cursor.off += 1;
  const major = initial >> 5;
  const minor = initial & 0x1f;
  const value = readLength(buf, cursor, minor);
  switch (major) {
    case 0: // unsigned int
      return value;
    case 1: // negative int
      return -1 - value;
    case 2: { // byte string
      const start = cursor.off;
      cursor.off += value;
      return buf.slice(start, cursor.off);
    }
    case 3: { // text string
      const start = cursor.off;
      cursor.off += value;
      return new TextDecoder().decode(buf.slice(start, cursor.off));
    }
    case 4: { // array
      const arr: unknown[] = [];
      for (let i = 0; i < value; i++) arr.push(readItem(buf, cursor));
      return arr;
    }
    case 5: { // map
      const m: Record<string | number, unknown> = {};
      for (let i = 0; i < value; i++) {
        const k = readItem(buf, cursor);
        const v = readItem(buf, cursor);
        m[k as string | number] = v;
      }
      return m;
    }
    default:
      throw new Error(`Unsupported CBOR major type ${major}`);
  }
}

function readLength(
  buf: Uint8Array,
  cursor: { off: number },
  minor: number,
): number {
  if (minor < 24) return minor;
  if (minor === 24) {
    const v = buf[cursor.off]!;
    cursor.off += 1;
    return v;
  }
  if (minor === 25) {
    const v = (buf[cursor.off]! << 8) | buf[cursor.off + 1]!;
    cursor.off += 2;
    return v;
  }
  if (minor === 26) {
    const v =
      buf[cursor.off]! * 0x1000000 +
      ((buf[cursor.off + 1]! << 16) |
        (buf[cursor.off + 2]! << 8) |
        buf[cursor.off + 3]!);
    cursor.off += 4;
    return v;
  }
  throw new Error(`CBOR length ${minor} not supported`);
}
