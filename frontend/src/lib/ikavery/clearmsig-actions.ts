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
import { ikaDkgWeb, type IkaDkgResult } from "./ika-web";
import { saveAttestation } from "./clearmsig-attestations";

/** Curve tag stored on chain alongside the dWallet handle. 2 = ed25519. */
export const DWALLET_CURVE_ED25519 = 2;

/**
 * Run real DKG against the Ika pre-alpha network and return the
 * 32-byte dWallet pubkey + the full attestation bundle the network
 * will demand at sign-time. v3a wiring; v2 used a placeholder.
 *
 * One gRPC-Web fetch round-trip to
 * `pre-alpha-dev-1.ika.ika-network.net`. Returns inside a few hundred
 * ms on a normal connection. Mock signer pre-alpha — the user
 * signature in the request is zero-filled and the network does the
 * crypto on its own.
 */
export async function runDkgForCreator(
  creator: PublicKey,
): Promise<IkaDkgResult> {
  return ikaDkgWeb(creator.toBytes());
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
  /**
   * Optional callback that fires as the create flow walks through its
   * stages. Lets the wizard render "running DKG…" / "submitting…"
   * micro-states instead of a single opaque spinner.
   */
  onProgress?: (stage: CreateVaultStage) => void;
}

export type CreateVaultStage = "dkg" | "build" | "sign" | "submit" | "confirm";

export interface CreateVaultResult {
  /** PDA address of the new Recovery. Use this to look it up later. */
  recovery: PublicKey;
  /** The fresh recoveryId pubkey used as the PDA seed. */
  recoveryId: PublicKey;
  /** Solana tx signature for explorer links. */
  txSignature: string;
  /** dWallet pubkey from DKG. Stored on the Recovery account. */
  dwalletPubkey: Uint8Array;
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
    onProgress,
  } = params;
  const progress = onProgress ?? (() => undefined);

  if (threshold !== 1) {
    throw new Error(
      `solo vault must have threshold=1 (got ${threshold}); add devices via enrollment for higher thresholds`,
    );
  }

  // Stage 1: Run DKG against the Ika pre-alpha network. This returns
  // the real 32-byte dWallet pubkey we'll store on chain, plus the
  // attestation bundle the network needs at sign-time. We persist
  // the bundle locally below so the sweep flow can use it later.
  progress("dkg");
  const dkg = await runDkgForCreator(creator);

  // Stage 2: build the create_recovery ix with the real dwallet
  // pubkey. Member 0 is the connected Solana wallet.
  progress("build");
  const members = [packSolanaMember(creator)];
  const recoveryIdKeypair = Keypair.generate();

  const { ix, recovery } = buildCreateRecoveryIx({
    creator,
    recoveryId: recoveryIdKeypair.publicKey,
    dwallet: dkg.publicKey,
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
  // we generated above.
  tx.sign([recoveryIdKeypair]);

  // Stage 3: hand off to the user's wallet for the creator signature.
  progress("sign");
  const signedTx = await signTransaction(tx);

  // Stage 4: submit + wait for confirmation.
  progress("submit");
  const sig = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  progress("confirm");
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  // Persist the attestation against this recovery PDA so the v3 sweep
  // flow can read it. Best-effort — if localStorage is blocked, the
  // vault still works; sweep will surface a clean "no attestation"
  // error and prompt re-DKG.
  saveAttestation(recovery.toBase58(), {
    attestationData: dkg.attestationData,
    networkSignature: dkg.networkSignature,
    networkPubkey: dkg.networkPubkey,
    publicKey: dkg.publicKey,
  });

  return {
    recovery,
    recoveryId: recoveryIdKeypair.publicKey,
    txSignature: sig,
    dwalletPubkey: dkg.publicKey,
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
