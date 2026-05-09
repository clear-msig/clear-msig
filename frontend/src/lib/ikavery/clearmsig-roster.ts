"use client";

// Roster-change action: bump a vault's approval threshold.
//
// On-chain dance is four instructions, each commenting on the row
// above:
//
//   1. stage_roster_change_payload — writes the additions / removals /
//      new_threshold to a staging PDA + records `payload_hash =
//      sha256(num_removals_le || ...len-prefixed-removals... ||
//      new_threshold_le || has_threshold_byte)`. No auth on this step;
//      anyone can stage. Trust gating happens at propose.
//   2. propose_roster_change — credential signs the payload_hash. The
//      handler verifies (a) staging.payload_hash matches, (b) the
//      credential is on the current roster.
//   3. approve_roster_change — each member's credential adds one vote.
//      Once approval_count >= threshold the proposal is approved.
//   4. execute_roster_change — applies the change to Recovery.members
//      and Recovery.threshold.
//
// For the threshold-bump case (no add/remove members, just change the
// quorum) on a 1-of-N vault using SCHEME_SOLANA_ADDRESS:
//   - Staging payload has additions=[], removals=[], threshold=newN.
//   - The connected wallet is on the roster, so its credential auths
//     both propose and approve (no precompile needed since
//     SCHEME_SOLANA_ADDRESS is verified via the tx signer list).
//   - All four ixs fit in one tx, one user popup.
//
// Why this commit ships wallet-mode only: passkey-mode would need
// precompile + WebAuthn assertions for both the propose challenge and
// the approve challenge — two passkey taps + two separate txs (the
// way the sweep flow handles it). Worth doing, but the wallet-mode
// case covers the common path "I have my wallet, lock down my own
// vault" cleanly. Passkey bump is a follow-up.

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { buildStageRosterChangePayloadIx } from "./ix/stage-roster-change";
import { buildProposeRosterChangeIx } from "./ix/propose-roster-change";
import { buildApproveRosterChangeIx } from "./ix/approve-roster-change";
import { buildExecuteRosterChangeIx } from "./ix/execute-roster-change";
import { packSolanaMember } from "./credential";
import { SCHEME_SOLANA_ADDRESS, MAX_MEMBERS } from "./constants";
import { fetchVault } from "./clearmsig-actions";
import { rosterChangePayloadHash } from "./passkey/challenges";
import type { AuthCredential } from "./ix/types";

export type BumpThresholdStage =
  | "build"
  | "sign"
  | "submit"
  | "confirm"
  | "done";

export interface BumpThresholdParams {
  connection: Connection;
  recovery: PublicKey;
  recoveryId: PublicKey;
  /** Connected Solana wallet — must be a roster member. Pays fees + auths. */
  creator: PublicKey;
  /** New threshold. Must be 1..members.length and != current threshold. */
  newThreshold: number;
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  onProgress?: (stage: BumpThresholdStage) => void;
}

export interface BumpThresholdResult {
  rosterChange: PublicKey;
  txSignature: string;
}

/**
 * Bundle stage + propose + approve + execute into one user-signed
 * transaction and confirm it on chain. Only valid when the connected
 * wallet is a roster member AND the current threshold is 1 (so the
 * proposer's single approve completes the quorum).
 *
 * Throws with a clear message on every other case so the wizard can
 * surface it inline:
 *   - wallet not on roster
 *   - newThreshold out of range / unchanged
 *   - threshold > 1 (would need additional approvals via a separate
 *     collect flow; not in this commit)
 *   - members empty / corrupt
 */
export async function bumpThresholdSimple(
  params: BumpThresholdParams,
): Promise<BumpThresholdResult> {
  const {
    connection,
    recovery,
    recoveryId,
    creator,
    newThreshold,
    signTransaction,
    onProgress,
  } = params;
  const progress = onProgress ?? (() => undefined);

  const { account } = await fetchVault(connection, recovery);
  const memberCount = account.members.length;
  if (memberCount < 2) {
    throw new Error(
      "Add a second device first — a 1-of-1 vault has no quorum to bump.",
    );
  }
  if (newThreshold < 1 || newThreshold > memberCount) {
    throw new Error(
      `New threshold must be between 1 and ${memberCount}.`,
    );
  }
  if (newThreshold === account.threshold) {
    throw new Error(
      `Vault is already ${account.threshold}-of-${memberCount}.`,
    );
  }
  if (newThreshold > MAX_MEMBERS) {
    throw new Error(`Threshold ${newThreshold} exceeds protocol cap ${MAX_MEMBERS}.`);
  }
  if (account.threshold !== 1) {
    throw new Error(
      `This commit's bundled bump only works on 1-of-N vaults (current threshold ${account.threshold}). For higher thresholds, the propose + approve dance needs additional signatures from other members.`,
    );
  }

  // Verify the connected wallet IS the (single) member that will both
  // propose and approve. On-chain the credential→member match is by
  // pubkey within the tx Signer set; checking client-side gives a
  // clearer error before the user pays for a sim that will fail.
  const creatorSlot = packSolanaMember(creator);
  const onRoster = account.members.some((m) =>
    bytesEqual(m, creatorSlot),
  );
  if (!onRoster) {
    throw new Error(
      "Connected wallet isn't on this vault's roster. Switch to a wallet member, or use the passkey-bump flow once it lands.",
    );
  }

  progress("build");

  const rosterChangeIndex = account.rosterChangeCount;
  const recoveryIdBytes = recoveryId.toBytes();

  // Payload: no add/remove, threshold-only change. The on-chain hash
  // helper (`auth::challenges::roster_change_payload`) hashes
  //   sha256(num_removals_le=0 || new_threshold_le || has_threshold=1)
  // additions are NOT in the hash by upstream's design; for a
  // bump-only path we leave additions empty so there's nothing
  // unauthenticated in the staging payload anyway.
  const payloadHash = rosterChangePayloadHash([], newThreshold, true);

  const credential: AuthCredential = {
    scheme: SCHEME_SOLANA_ADDRESS,
    pubkey: creator.toBytes(),
  };

  const { ix: stageIx } = buildStageRosterChangePayloadIx({
    recovery,
    recoveryId,
    rosterChangeIndex,
    payer: creator,
    additions: [],
    removals: [],
    additionApproverOnlyBitmap: 0,
    newThreshold,
  });
  // Staging defines `staging` PDA; propose & execute reference the
  // same one.
  void recoveryIdBytes; // (silences unused-var warning when not in passkey branch)

  const { ix: proposeIx, rosterChange } = buildProposeRosterChangeIx({
    recovery,
    recoveryId,
    rosterChangeIndex,
    payer: creator,
    payloadHash,
    credential,
  });

  const { ix: approveIx } = buildApproveRosterChangeIx({
    recovery,
    rosterChange,
    payer: creator,
    memberSlot: creatorSlot,
    credential,
  });

  const executeIx = buildExecuteRosterChangeIx({
    recovery,
    rosterChange,
    payer: creator,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions: [stageIx, proposeIx, approveIx, executeIx],
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
  return { rosterChange, txSignature: sig };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
