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
//      will never reference again - pure nonce material).
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
import {
  cpiAuthorityPda,
  dwalletPda,
  IKA_DWALLET_PROGRAM_ID,
  CURVE_CURVE25519,
} from "./dwallet";
import { buildTransferDwalletAuthorityIx } from "./dwallet/transfer-authority";
import { IKAVERY_PROGRAM_ID } from "./constants";

/** Curve tag stored on chain alongside the dWallet handle. 2 = ed25519. */
export const DWALLET_CURVE_ED25519 = 2;

/**
 * Run real DKG against the Ika pre-alpha network and return the
 * 32-byte dWallet pubkey + the full attestation bundle the network
 * will demand at sign-time. v3a wiring; v2 used a placeholder.
 *
 * One gRPC-Web fetch round-trip to
 * `pre-alpha-dev-1.ika.ika-network.net`. Returns inside a few hundred
 * ms on a normal connection. Mock signer pre-alpha - the user
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
  /** Connected wallet pubkey - pays rent + becomes member 0. */
  creator: PublicKey;
  /** Approval threshold (1..=members.length). */
  threshold: number;
  /**
   * Sign callback - Dynamic's signTransaction wrapped from useWallet().
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

export type CreateVaultStage =
  | "dkg"
  | "wait-dwallet"
  | "build"
  | "sign"
  | "submit"
  | "confirm";

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

  // Stage 1b: wait for the dWallet account to appear on the Ika
  // dWallet program. The pre-alpha mock signer auto-commits the row
  // within a few seconds of DKG. We need it to exist before the
  // TransferOwnership ix in the next step can move authority over to
  // ikavery's CPI authority PDA.
  progress("wait-dwallet");
  const { pda: dwalletAccountPda } = dwalletPda(
    CURVE_CURVE25519,
    dkg.publicKey,
  );
  await waitForAccount(connection, dwalletAccountPda, 25_000);

  // Stage 2: build the on-chain bundle.
  //   • create_recovery - stores the dwallet pubkey on the Recovery
  //     row, member 0 is the connected Solana wallet.
  //   • TransferOwnership - hands the dWallet's authority from the
  //     creator (initial authority after DKG) to ikavery's CPI
  //     authority PDA, so future execute paths can issue
  //     MessageApproval CPIs without an extra user signature.
  // Both go in one tx so the user signs once.
  progress("build");
  const members = [packSolanaMember(creator)];
  const recoveryIdKeypair = Keypair.generate();

  const { ix: createIx, recovery } = buildCreateRecoveryIx({
    creator,
    recoveryId: recoveryIdKeypair.publicKey,
    dwallet: dkg.publicKey,
    dwalletCurve,
    threshold,
    members,
  });
  const { pda: cpiAuthority } = cpiAuthorityPda(IKAVERY_PROGRAM_ID);
  const transferIx = buildTransferDwalletAuthorityIx({
    currentAuthority: creator,
    dwallet: dwalletAccountPda,
    newAuthority: cpiAuthority,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions: [createIx, transferIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  // Sign the recoveryId slot first - that's the throwaway keypair
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
  // flow can read it. Best-effort - if localStorage is blocked, the
  // vault still works; sweep will surface a clean "no attestation"
  // error and prompt re-DKG.
  saveAttestation(recovery.toBase58(), {
    attestationData: dkg.attestationData,
    networkSignature: dkg.networkSignature,
    networkPubkey: dkg.networkPubkey,
    publicKey: dkg.publicKey,
    dwalletAddr: dkg.dwalletAddr,
  });

  return {
    recovery,
    recoveryId: recoveryIdKeypair.publicKey,
    txSignature: sig,
    dwalletPubkey: dkg.publicKey,
  };
}

/**
 * Poll until `pubkey` exists on chain or `timeoutMs` elapses. The Ika
 * pre-alpha mock signer auto-commits the dWallet account within a few
 * seconds of DKG; this helper just waits for that to land.
 */
async function waitForAccount(
  connection: Connection,
  pubkey: PublicKey,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const info = await connection.getAccountInfo(pubkey, "confirmed");
      if (info && info.data.length > 0) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(
    `Ika network is slow today — the dWallet didn't commit within ${Math.round(
      timeoutMs / 1000,
    )}s. Refresh and click Build again; nothing was lost (you haven't signed a Solana tx yet)${
      lastError
        ? ` — last RPC error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
        : ""
    }`,
  );
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
