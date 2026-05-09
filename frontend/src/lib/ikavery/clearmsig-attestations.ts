"use client";

// Local persistence for the per-vault Ika DKG attestation bundle.
//
// When a user runs DKG to mint a dWallet for a new Recovery, the
// network returns three byte arrays: `attestation_data`,
// `network_signature`, `network_pubkey`. The on-chain Recovery row
// only stores the dWallet's 32-byte public key - the rest of the
// attestation is required at SIGN time (sweep + roster change +
// enrollment), and there's no on-chain slot for it.
//
// We persist the bundle in localStorage keyed by Recovery PDA so
// the same browser can run sweeps later. Same wallet on a fresh
// browser will need to either re-derive the attestation (not
// supported by pre-alpha) or be told upfront that sweep is
// browser-bound at v3. For v3a we just persist; the v3c sweep flow
// will read from this store.
//
// Schema versioned via a key prefix so a future migration can be
// detected and ignored without dropping unrelated localStorage data.

const STORAGE_KEY = "clear.ikavery-attestations.v1";

interface StoredAttestation {
  attestationData: string; // hex
  networkSignature: string;
  networkPubkey: string;
  /** dWallet pubkey hex (32 bytes) - kept for sanity-checking the
   *  on-chain Recovery row matches. */
  publicKey: string;
  /**
   * 32-byte session identifier returned from DKG (= what the CLI calls
   * `dwallet_addr`). Required as `session_identifier_preimage` for the
   * Presign / Sign gRPC calls. Optional in the stored shape so older
   * v3a entries - written before this field existed - still load.
   */
  dwalletAddr?: string;
  ts: number;
}

interface StoredAttestationMap {
  [recoveryPdaBase58: string]: StoredAttestation;
}

function readAll(): StoredAttestationMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as StoredAttestationMap;
    }
    return {};
  } catch {
    return {};
  }
}

function writeAll(next: StoredAttestationMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage full / blocked - silent. v3 sweep will fail with
     * "no attestation" rather than corrupting other state. */
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export interface AttestationBundle {
  attestationData: Uint8Array;
  networkSignature: Uint8Array;
  networkPubkey: Uint8Array;
  publicKey: Uint8Array;
  /**
   * Session identifier from the V1 DKG attestation. v3a entries written
   * before this field existed return undefined; the sweep flow falls
   * back to a re-DKG prompt in that case.
   */
  dwalletAddr?: Uint8Array;
}

export function saveAttestation(
  recoveryPdaBase58: string,
  bundle: AttestationBundle,
): void {
  const all = readAll();
  all[recoveryPdaBase58] = {
    attestationData: bytesToHex(bundle.attestationData),
    networkSignature: bytesToHex(bundle.networkSignature),
    networkPubkey: bytesToHex(bundle.networkPubkey),
    publicKey: bytesToHex(bundle.publicKey),
    dwalletAddr: bundle.dwalletAddr ? bytesToHex(bundle.dwalletAddr) : undefined,
    ts: Date.now(),
  };
  writeAll(all);
}

export function loadAttestation(
  recoveryPdaBase58: string,
): AttestationBundle | null {
  const all = readAll();
  const stored = all[recoveryPdaBase58];
  if (!stored) return null;
  try {
    return {
      attestationData: hexToBytes(stored.attestationData),
      networkSignature: hexToBytes(stored.networkSignature),
      networkPubkey: hexToBytes(stored.networkPubkey),
      publicKey: hexToBytes(stored.publicKey),
      dwalletAddr: stored.dwalletAddr ? hexToBytes(stored.dwalletAddr) : undefined,
    };
  } catch {
    return null;
  }
}

export function hasAttestation(recoveryPdaBase58: string): boolean {
  return !!readAll()[recoveryPdaBase58];
}
