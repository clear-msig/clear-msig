"use client";

// clear-msig integration glue for the vendored ikavery SDK.
//
// Lives alongside the vendored SDK so it's clear which functions belong
// to clear-msig (this file) vs upstream ikavery (everything else under
// lib/ikavery/). Wraps the SDK's instruction builders with our wallet
// signing flow:
//
//   1. Build the create-recovery ix via the SDK.
//   2. Compose a v0 transaction.
//   3. Sign the recoveryId slot locally (it's a fresh Keypair the user
//      will never reference again — pure nonce material).
//   4. Hand the partially-signed tx to the user's Dynamic wallet for
//      the creator signature.
//   5. Submit + confirm.
//
// Why a fresh recoveryId keypair: the on-chain `create_recovery` ix
// uses the recoveryId pubkey as a PDA seed so a single creator can
// host multiple vaults. The keypair signs once at create-time and is
// then orphaned; the Recovery account references the creator + member
// roster from then on.
//
// Why Curve25519: clear-msig binds everything through Solana, so the
// dWallet curve is always ed25519 / Curve25519 in our integration.
// The 32-byte dwallet handle is opaque to the program; in v2 we
// generate a random one client-side as a placeholder. Real DKG
// against the Ika pre-alpha network is the v3 lift.

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { buildCreateRecoveryIx } from "./ix/create-recovery";
import { packSolanaMember } from "./credential";
import { listAllRecoveries, type DecodedRecovery } from "./discovery";
import { decodeRecovery } from "./codec/recovery";

/** Curve tag stored on chain alongside the dWallet handle. 2 = ed25519. */
export const DWALLET_CURVE_ED25519 = 2;

/**
 * Generate the 32-byte dWallet handle stored on the Recovery account.
 * In v2 this is a deterministic placeholder derived from the creator's
 * pubkey + a per-vault nonce; the real DKG against Ika's pre-alpha
 * network is deferred to v3 (would need a gRPC-Web call to
 * `pre-alpha-dev-1.ika.ika-network.net`).
 *
 * The handle is opaque to the program and the SDK — `create_recovery`
 * stores it verbatim and emits it back from `propose_sweep` so the
 * sweep flow can pass it to the dWallet program. Until that v3 lift
 * lands, the handle is just an identifier; sweep won't yet broadcast.
 */
export function placeholderDwalletHandle(creator: PublicKey): Uint8Array {
  // Mix the creator pubkey with a random nonce so collisions across
  // vaults from the same creator are impossible. 32 bytes = the wire
  // format the program expects.
  const out = new Uint8Array(32);
  const creatorBytes = creator.toBytes();
  for (let i = 0; i < 32; i++) out[i] = creatorBytes[i] ?? 0;
  // XOR in 16 random bytes so two vaults from the same creator
  // produce different handles.
  const nonce = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(nonce);
  }
  for (let i = 0; i < 16; i++) out[16 + i] ^= nonce[i] ?? 0;
  return out;
}

export interface CreateVaultParams {
  connection: Connection;
  /** Connected wallet pubkey — pays rent + becomes member 0. */
  creator: PublicKey;
  /** Approval threshold (1..=members.length). */
  threshold: number;
  /**
   * Sign callback — Dynamic's signTransaction wrapped from useWallet().
   * Receives the partially-signed tx (recoveryId slot already filled),
   * returns the same tx with the user's signature added.
   */
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  /**
   * Optional curve override. Defaults to ed25519 because clear-msig
   * users always come in via a Solana wallet.
   */
  dwalletCurve?: number;
}

export interface CreateVaultResult {
  /** PDA address of the new Recovery. Use this to look it up later. */
  recovery: PublicKey;
  /** The fresh recoveryId pubkey used as the PDA seed. */
  recoveryId: PublicKey;
  /** Solana tx signature for explorer links. */
  txSignature: string;
}

/**
 * Build, sign, and submit a create-recovery transaction. The user is
 * the only initial member; they can add devices / passkeys later via
 * the enrollment flow (v3).
 */
export async function createSoloVault(
  params: CreateVaultParams,
): Promise<CreateVaultResult> {
  const {
    connection,
    creator,
    threshold,
    signTransaction,
    dwalletCurve = DWALLET_CURVE_ED25519,
  } = params;

  // Sanity guard: threshold must be exactly 1 for a single-member
  // vault. The wizard enforces this in the UI; check again here so
  // a mis-wired caller doesn't silently submit a doomed tx.
  if (threshold !== 1) {
    throw new Error(
      `solo vault must have threshold=1 (got ${threshold}); add devices via enrollment for higher thresholds`,
    );
  }

  // Member 0 is the connected Solana wallet. `packSolanaMember`
  // returns the on-chain MemberSlot wire format (scheme byte +
  // padded pubkey).
  const members = [packSolanaMember(creator)];

  const recoveryIdKeypair = Keypair.generate();
  const dwallet = placeholderDwalletHandle(creator);

  const { ix, recovery } = buildCreateRecoveryIx({
    creator,
    recoveryId: recoveryIdKeypair.publicKey,
    dwallet,
    dwalletCurve,
    threshold,
    members,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  // Sign the recoveryId slot first — that's the throwaway keypair
  // we generated above. tx.sign matches signers to header slots
  // by pubkey, so passing only this Keypair fills only its slot.
  tx.sign([recoveryIdKeypair]);

  // Hand off to the user's wallet for the creator signature. Dynamic
  // returns the same VersionedTransaction with both signatures in place.
  const signedTx = await signTransaction(tx);

  const sig = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  return {
    recovery,
    recoveryId: recoveryIdKeypair.publicKey,
    txSignature: sig,
  };
}

/**
 * Fetch every Recovery account on the cluster + filter to those
 * where `creator` is one of the members. Used by the /app/secure
 * landing to render "your vaults" without needing a server-side
 * index.
 */
export async function listVaultsForCreator(
  connection: Connection,
  creator: PublicKey,
): Promise<DecodedRecovery[]> {
  const all = await listAllRecoveries(connection);
  const memberSlot = packSolanaMember(creator);
  return all.filter((r) => {
    for (const slot of r.account.members) {
      if (slot.length !== memberSlot.length) continue;
      let eq = true;
      for (let i = 0; i < slot.length; i++) {
        if (slot[i] !== memberSlot[i]) {
          eq = false;
          break;
        }
      }
      if (eq) return true;
    }
    return false;
  });
}

/**
 * Look up a single Recovery by PDA. Wraps `getAccountInfo` + the
 * SDK's decoder. Throws when the account is missing or unparseable
 * so the page-level loader can show a clean "not found" state.
 */
export async function fetchVault(
  connection: Connection,
  recovery: PublicKey,
): Promise<DecodedRecovery> {
  const info = await connection.getAccountInfo(recovery, "confirmed");
  if (!info) {
    throw new Error("Vault not found on this cluster");
  }
  return {
    recovery,
    account: decodeRecovery(info.data),
  };
}
