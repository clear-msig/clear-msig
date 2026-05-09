"use client";

import type { Connection, PublicKey } from "@solana/web3.js";
import { decodeRecovery } from "./codec/recovery";

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

/**
 * Sign-time attestation loader. The persistent localStorage entry is
 * a CACHE — the canonical source of `dwallet pubkey` is the on-chain
 * Recovery account, which the Solana validators authenticate. This
 * function refuses to return an attestation whose `publicKey` doesn't
 * match `Recovery.dwallet`, defending against the
 * localStorage-tamper → wrong-dwallet substitution attack (a malicious
 * userscript / supply-chain compromise / dev-tools tamper that would
 * otherwise let an attacker swap the dwallet pubkey + downstream PDA
 * derivations + fee-payer + Ika-signed message bytes).
 *
 * Other fields (`attestationData`, `networkSignature`, `networkPubkey`,
 * `dwalletAddr`) don't need explicit integrity checks here: if any of
 * them are tampered, the Ika gRPC presign/sign call rejects because
 * the tampered bundle doesn't identify a valid DKG session, so the
 * sign step fails before any tx leaves the browser.
 *
 * Throws on every failure mode (no cached entry, account not found on
 * chain, dwallet mismatch). Callers should treat the throw as
 * fund-impacting and surface a loud error.
 */
export async function loadAttestationVerified(
  connection: Connection,
  recovery: PublicKey,
): Promise<AttestationBundle> {
  const stored = loadAttestation(recovery.toBase58());
  if (!stored) {
    throw new Error(
      "No DKG attestation for this vault on this device. Re-mint via /secure/new (or sign in on the device that created it).",
    );
  }
  if (stored.publicKey.length !== 32) {
    throw new Error(
      `Local attestation has wrong dwallet pubkey length (${stored.publicKey.length}b, expected 32b). Refusing to sign.`,
    );
  }
  const info = await connection.getAccountInfo(recovery, "confirmed");
  if (!info || info.data.length === 0) {
    throw new Error(
      `Recovery account ${recovery.toBase58()} not found on chain. Refusing to sign.`,
    );
  }
  let onChainDwallet: Uint8Array;
  try {
    const account = decodeRecovery(new Uint8Array(info.data));
    onChainDwallet = account.dwallet.toBytes();
  } catch (e) {
    throw new Error(
      `Couldn't decode the on-chain Recovery row: ${e instanceof Error ? e.message : String(e)}. Refusing to sign.`,
    );
  }
  if (!bytesEq(stored.publicKey, onChainDwallet)) {
    throw new Error(
      "Local attestation's dwallet pubkey doesn't match the on-chain Recovery — your localStorage may have been tampered with. Refusing to sign.",
    );
  }
  return stored;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
