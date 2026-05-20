"use client";

// clear-msig enrollment flow - adds a new passkey member to an
// existing Recovery roster.
//
// The on-chain dance is three instructions:
//
//   1. propose_enrollment  - an existing member opens an enrollment
//                            proposal, naming the new passkey as the
//                            addition.
//   2. approve_enrollment  - the same member votes yes. Solo vault,
//                            threshold of 1, so this single vote
//                            completes approvals.
//   3. execute_enrollment  - once approvals >= threshold, the program
//                            writes the new member into the roster.
//
// Two auth modes (mirrors clearmsig-sweep.ts):
//
//   - "wallet": connected Solana wallet authorises (must be a roster
//     member). The credential is SCHEME_SOLANA_ADDRESS — no inline
//     sig — so all three ixs ride in ONE user-signed tx. This is the
//     "I have my wallet, add a new device" flow.
//   - "passkey": connected wallet pays fees but is NOT a member.
//     An existing passkey authorises. Two precompile + two ixs split
//     into TWO user-signed txs:
//       tx A: [secp256r1-precompile, propose_enrollment]   ← passkey tap
//       tx B: [secp256r1-precompile, approve_enrollment, execute_enrollment]
//                                                          ← passkey tap
//     This is the "lost wallet, recovering via existing passkey to
//     enroll a new one" flow.
//
// Why a single tx for wallet mode: SCHEME_SOLANA_ADDRESS doesn't need
// a precompile, so propose+approve+execute fit cleanly. For passkey
// mode the per-op precompile + assertion-per-challenge forces two
// passkey taps; bundling them in one tx would prompt the OS twice in
// rapid succession before the wallet popup, which feels like a bug.

import {
  Connection,
  PublicKey,
  type TransactionInstruction,
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
import {
  enrollProposeChallenge,
  enrollApproveChallenge,
} from "./passkey/challenges";
import { runPasskeySign } from "./passkey/sign";

export type EnrollAuthMode = "wallet" | "passkey";

export type EnrollDeviceStage =
  | "build"
  | "propose-passkey"
  | "sign"
  | "submit"
  | "confirm"
  | "approve-passkey"
  | "approve-sign"
  | "approve-confirm"
  | "done";

export interface EnrollPasskeyParams {
  connection: Connection;
  recovery: PublicKey;
  /** The recoveryId pubkey from the original `create_recovery`. */
  recoveryId: PublicKey;
  /**
   * Connected Solana wallet — pays fees on every leg. Must be a roster
   * member only when `authMode === "wallet"`.
   */
  creator: PublicKey;
  /** Compressed 33-byte P-256 pubkey from the new passkey. */
  newPasskeyPubkey: Uint8Array;
  /**
   * 32-byte encryption-key address. The create/enroll flows set this
   * to the dWallet pubkey; the field is opaque to the program today
   * but is stored on the EnrollmentProposal for forward compatibility.
   */
  encryptionKeyAddress: Uint8Array;
  /** Sign callback - Dynamic's signTransaction wrapped from useWallet(). */
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  /** Auth mode — defaults to "wallet" so legacy callers stay unchanged. */
  authMode?: EnrollAuthMode;
  /** Optional RP id for passkey assertions. Defaults to window.location.hostname. */
  rpId?: string;
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
 * Add a new passkey member to a vault and finalise it.
 *
 * Pre-conditions:
 *   - The vault's threshold is 1. Multi-member quorums need every
 *     existing member to contribute a separate approval; that's a
 *     follow-up flow.
 *   - "wallet" mode: `creator` (the connected Solana wallet) is a
 *     roster member. We bundle propose+approve+execute in one tx.
 *   - "passkey" mode: an existing passkey on this device is a roster
 *     member. The OS picker + ECDSA pubkey-recovery resolve which
 *     member is signing. Two separate txs (one per challenge).
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
    authMode = "wallet",
    rpId,
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
  //   - sanity-check the threshold so we fail fast on multi-member
  //     vaults that need an N-of-M enrollment flow we don't ship yet.
  const { account } = await fetchVault(connection, recovery);
  if (account.threshold !== 1) {
    throw new Error(
      `Multi-member enrollment quorum isn't supported yet (threshold ${account.threshold}). Solo (1-of-N) vaults work today; M-of-N enrollment lands when each existing member has a way to chip in their slice of the approval.`,
    );
  }

  const newMember = packMemberSlot(SCHEME_WEBAUTHN, newPasskeyPubkey);
  const enrollmentIndex = account.enrollmentCount;
  const recoveryIdBytes = recoveryId.toBytes();

  if (authMode === "wallet") {
    // Wallet mode: SCHEME_SOLANA_ADDRESS for both propose + approve.
    // No precompiles needed, but the propose ix carries 429 bytes of
    // data (`MAX_CLIENT_DATA_JSON_BYTES` is fixed-size on the wire so
    // even SOLANA_ADDRESS pays the cost) and approve adds another 358.
    // Bundling propose+approve+execute into one tx tipped over Solana's
    // 1232-byte packet limit (~1245 bytes raw → 1660 base64), so we
    // split into two user-signed txs:
    //   tx A: [propose]
    //   tx B: [approve, execute]
    // Two popups instead of one is the trade-off; the propose has to
    // confirm before approve can write its PDA anyway.
    progress("build");
    const credential: AuthCredential = {
      scheme: SCHEME_SOLANA_ADDRESS,
      pubkey: creator.toBytes(),
    };
    const creatorMemberSlot = packSolanaMember(creator);

    const { ix: proposeIx, enrollment } = buildProposeEnrollmentIx({
      recovery,
      recoveryId,
      enrollmentIndex,
      payer: creator,
      newMember,
      newEncryptionKeyAddress: encryptionKeyAddress,
      additionApproverOnly: 0,
      credential,
    });
    await sendBundle(
      connection,
      creator,
      [proposeIx],
      signTransaction,
      () => progress("sign"),
      () => progress("submit"),
      () => progress("confirm"),
    );

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
    const sig = await sendBundle(
      connection,
      creator,
      [approveIx, executeIx],
      signTransaction,
      () => progress("approve-sign"),
      () => progress("approve-confirm"),
      () => progress("approve-confirm"),
    );
    progress("done");
    return { enrollment, txSignature: sig };
  }

  // Passkey mode. Two separate user-signed txs:
  //   tx A: [secp256r1-precompile, propose_enrollment]   ← passkey tap
  //   tx B: [secp256r1-precompile, approve_enrollment, execute_enrollment]
  //                                                      ← passkey tap
  // The connected wallet pays fees on both; doesn't need to be a member.

  // --- propose ---
  progress("propose-passkey");
  const proposeC = enrollProposeChallenge(
    recoveryIdBytes,
    newPasskeyPubkey,
    enrollmentIndex,
  );
  const proposeAssertion = await runPasskeySign({
    challenge: proposeC,
    rpId,
  });
  const proposePub = await pickRosterPubkey(
    account.members,
    proposeAssertion.candidatePubkeys,
  );
  const { precompileIx: proposePrecompile, credential: proposeCred } =
    proposeAssertion.build(proposePub);

  const { ix: proposeIx, enrollment } = buildProposeEnrollmentIx({
    recovery,
    recoveryId,
    enrollmentIndex,
    payer: creator,
    newMember,
    newEncryptionKeyAddress: encryptionKeyAddress,
    additionApproverOnly: 0,
    credential: proposeCred,
  });
  await sendBundle(
    connection,
    creator,
    [proposePrecompile, proposeIx],
    signTransaction,
    () => progress("sign"),
    () => progress("submit"),
    () => progress("confirm"),
  );

  // --- approve + execute ---
  progress("approve-passkey");
  const approveC = enrollApproveChallenge(recoveryIdBytes, enrollmentIndex);
  const approveAssertion = await runPasskeySign({
    challenge: approveC,
    rpId,
  });
  const approvePub = await pickRosterPubkey(
    account.members,
    approveAssertion.candidatePubkeys,
  );
  const { precompileIx: approvePrecompile, credential: approveCred } =
    approveAssertion.build(approvePub);
  const approverMemberSlot = packMemberSlot(SCHEME_WEBAUTHN, approvePub);
  const { ix: approveIx } = buildApproveEnrollmentIx({
    recovery,
    enrollment,
    payer: creator,
    memberSlot: approverMemberSlot,
    credential: approveCred,
  });
  const executeIx = buildExecuteEnrollmentIx({
    recovery,
    enrollment,
    payer: creator,
  });
  const sig = await sendBundle(
    connection,
    creator,
    [approvePrecompile, approveIx, executeIx],
    signTransaction,
    () => progress("approve-sign"),
    () => progress("approve-confirm"),
    () => progress("approve-confirm"),
  );

  progress("done");
  return { enrollment, txSignature: sig };
}

/**
 * Match each ECDSA-recovered candidate against the on-chain roster's
 * SCHEME_WEBAUTHN slots and return the one that's actually a member.
 * Throws if neither candidate matches.
 */
async function pickRosterPubkey(
  members: Uint8Array[],
  candidates: Uint8Array[],
): Promise<Uint8Array> {
  for (const cand of candidates) {
    const slot = packMemberSlot(SCHEME_WEBAUTHN, cand);
    for (const memberSlot of members) {
      if (memberSlot.length !== slot.length) continue;
      let eq = true;
      for (let i = 0; i < slot.length; i++) {
        if (memberSlot[i] !== slot[i]) {
          eq = false;
          break;
        }
      }
      if (eq) return cand;
    }
  }
  throw new Error(
    "The passkey you picked isn't on this vault's roster. Pick a passkey that's enrolled here, or use Wallet auth instead.",
  );
}

async function sendBundle(
  connection: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>,
  onSign: () => void,
  onSubmit: () => void,
  onConfirm: () => void,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  onSign();
  const signed = await signTransaction(tx);
  onSubmit();
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  onConfirm();
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}
