"use client";

// clear-msig enrollment flow - adds a new member (passkey today,
// other schemes later) to an existing Recovery roster.
//
// The on-chain dance is three instructions in one transaction:
//
//   1. propose_enrollment  - member 0 (the connected Solana wallet)
//                            opens an enrollment proposal, naming the
//                            new MemberSlot as the addition.
//   2. approve_enrollment  - member 0 votes yes. Solo vault, threshold
//                            of 1, so this single vote completes
//                            approvals.
//   3. execute_enrollment  - once approval bitmap >= threshold, the
//                            program writes the new member into the
//                            roster.
//
// All three sit inside a single user-signed Solana transaction. The
// existing Solana-wallet member uses the `SCHEME_SOLANA_ADDRESS`
// credential, which has no inline signature - the on-chain handler
// verifies the credential's pubkey appears as a Signer on the tx.
//
// Why a single tx (not three): a multi-tx flow needs the user to
// sign three popups, and a partial state (proposal-but-no-execute)
// is awkward to recover from. One tx + one signature is the right
// retail UX, and v3a's solo-vault model fits inside Solana's tx
// size budget comfortably.

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { buildProposeEnrollmentIx } from "./ix/propose-enrollment";
import { buildApproveEnrollmentIx } from "./ix/approve-enrollment";
import { buildExecuteEnrollmentIx } from "./ix/execute-enrollment";
import { packMemberSlot, packSolanaMember } from "./credential";
import {
  SCHEME_SOLANA_ADDRESS,
  SCHEME_WEBAUTHN,
} from "./constants";
import { fetchVault } from "./clearmsig-actions";
import type { AuthCredential } from "./ix/types";

export type EnrollDeviceStage =
  | "build"
  | "sign"
  | "submit"
  | "confirm"
  | "done";

export interface EnrollPasskeyParams {
  connection: Connection;
  recovery: PublicKey;
  /** The recoveryId pubkey from the original `create_recovery`. */
  recoveryId: PublicKey;
  /** Connected Solana wallet - must already be a member of the recovery. */
  creator: PublicKey;
  /** Compressed 33-byte P-256 pubkey from the new passkey. */
  newPasskeyPubkey: Uint8Array;
  /**
   * 32-byte encryption-key address. v3 sets this to the dWallet pubkey;
   * the field is opaque to the program today (re-encrypt CPI lands at
   * mainnet) but is stored on the EnrollmentProposal for forward
   * compatibility.
   */
  encryptionKeyAddress: Uint8Array;
  /** Sign callback - Dynamic's signTransaction wrapped from useWallet(). */
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  /** Optional progress reporter for the wizard. */
  onProgress?: (stage: EnrollDeviceStage) => void;
}

export interface EnrollPasskeyResult {
  /** EnrollmentProposal PDA (so the UI can link to its explorer page). */
  enrollment: PublicKey;
  /** Tx signature for the bundle. */
  txSignature: string;
}

/**
 * Add a new passkey member to a vault and finalise it in one tx.
 *
 * Pre-conditions:
 *   - `creator` is already a roster member (today: member 0 of the
 *     solo vault).
 *   - The vault's threshold is 1 (otherwise approve_enrollment alone
 *     wouldn't reach quorum and execute_enrollment would fail).
 *
 * Throws if the vault isn't found or has a higher threshold than the
 * single voter can satisfy.
 */
export async function enrollPasskeyForVault(
  params: EnrollPasskeyParams,
): Promise<EnrollPasskeyResult> {
  const {
    connection,
    recovery,
    recoveryId,
    creator,
    newPasskeyPubkey,
    encryptionKeyAddress,
    signTransaction,
    onProgress,
  } = params;
  const progress = onProgress ?? (() => undefined);

  if (newPasskeyPubkey.length !== 33) {
    throw new Error(
      `Passkey pubkey must be 33-byte compressed P-256 (got ${newPasskeyPubkey.length})`,
    );
  }
  if (encryptionKeyAddress.length !== 32) {
    throw new Error(
      `Encryption key address must be 32 bytes (got ${encryptionKeyAddress.length})`,
    );
  }

  // Read the current vault state for two reasons:
  //   - find the next enrollment_count (program rejects with WrongIndex
  //     otherwise),
  //   - sanity-check the threshold so we fail fast when the user is on
  //     a multi-member vault that v3a doesn't yet support.
  const { account } = await fetchVault(connection, recovery);
  if (account.threshold !== 1) {
    throw new Error(
      `Multi-member enrollment requires the additional members to vote - v3a only supports solo (1-of-N) vaults. Current threshold: ${account.threshold}`,
    );
  }

  progress("build");

  const newMember = packMemberSlot(SCHEME_WEBAUTHN, newPasskeyPubkey);
  const creatorMemberSlot = packSolanaMember(creator);

  // Solana wallets sign the transaction directly - no embedded
  // ECDSA / WebAuthn assertion. The on-chain handler matches the
  // credential's pubkey against the tx's Signers.
  const credential: AuthCredential = {
    scheme: SCHEME_SOLANA_ADDRESS,
    pubkey: creator.toBytes(),
  };

  const { ix: proposeIx, enrollment } = buildProposeEnrollmentIx({
    recovery,
    recoveryId,
    enrollmentIndex: account.enrollmentCount,
    payer: creator,
    newMember,
    newEncryptionKeyAddress: encryptionKeyAddress,
    additionApproverOnly: 0,
    credential,
  });

  const { ix: approveIx } = buildApproveEnrollmentIx({
    recovery,
    enrollment,
    payer: creator,
    memberSlot: creatorMemberSlot,
    credential,
  });

  const executeIx = buildExecuteEnrollmentIx({
    recovery,
    enrollment,
    payer: creator,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions: [proposeIx, approveIx, executeIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  progress("sign");
  const signed = await signTransaction(tx);

  progress("submit");
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  progress("confirm");
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  progress("done");
  return { enrollment, txSignature: sig };
}
