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
// Two auth modes, mirroring sweep + enroll:
//
//   "wallet"  — connected Solana wallet IS a roster member. The
//               credential is SCHEME_SOLANA_ADDRESS (no inline sig)
//               so all four ixs ride in ONE user-signed tx.
//   "passkey" — connected wallet pays fees but isn't a member; an
//               existing passkey on this device is. Two split txs
//               with secp256r1 precompiles for the propose and
//               approve challenges. Two passkey taps + two wallet
//               popups. This is the "lost wallet, lock down via
//               passkey" path.

import {
  Connection,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { buildStageRosterChangePayloadIx } from "./ix/stage-roster-change";
import { buildProposeRosterChangeIx } from "./ix/propose-roster-change";
import { buildApproveRosterChangeIx } from "./ix/approve-roster-change";
import { buildExecuteRosterChangeIx } from "./ix/execute-roster-change";
import { packMemberSlot, packSolanaMember } from "./credential";
import {
  SCHEME_SOLANA_ADDRESS,
  SCHEME_WEBAUTHN,
  MAX_MEMBERS,
} from "./constants";
import { fetchVault } from "./clearmsig-actions";
import {
  rosterChangePayloadHash,
  rosterChangeProposeChallenge,
  rosterChangeApproveChallenge,
} from "./passkey/challenges";
import { runPasskeySign } from "./passkey/sign";
import type { AuthCredential } from "./ix/types";

export type BumpAuthMode = "wallet" | "passkey";

export type BumpThresholdStage =
  | "build"
  | "propose-passkey"
  | "sign"
  | "submit"
  | "confirm"
  | "approve-passkey"
  | "approve-sign"
  | "approve-confirm"
  | "done";

export interface BumpThresholdParams {
  connection: Connection;
  recovery: PublicKey;
  recoveryId: PublicKey;
  /** Connected Solana wallet — pays fees on every leg. Roster member only when authMode === "wallet". */
  creator: PublicKey;
  /** New threshold. Must be 1..members.length and != current threshold. */
  newThreshold: number;
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  /** Defaults to "wallet" so legacy callers stay unchanged. */
  authMode?: BumpAuthMode;
  /** RP id for passkey assertions. Defaults to window.location.hostname. */
  rpId?: string;
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
    authMode = "wallet",
    rpId,
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

  // Wallet mode requires the connected wallet to BE the member that
  // proposes + approves. Passkey mode bypasses the check because the
  // connected wallet only pays fees there — the actual auth comes
  // from a passkey assertion at sign time.
  const creatorSlot = packSolanaMember(creator);
  if (authMode === "wallet") {
    const onRoster = account.members.some((m) => bytesEqual(m, creatorSlot));
    if (!onRoster) {
      throw new Error(
        "Connected wallet isn't on this vault's roster. Switch wallets, or pick Passkey instead.",
      );
    }
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

  let rosterChange: PublicKey;
  let txSignature: string;

  if (authMode === "wallet") {
    // Wallet mode: SCHEME_SOLANA_ADDRESS for both propose and approve;
    // matching by tx Signer set means no inline sig needed and we can
    // bundle stage+propose+approve+execute in ONE user-signed tx.
    const credential: AuthCredential = {
      scheme: SCHEME_SOLANA_ADDRESS,
      pubkey: creator.toBytes(),
    };
    const { ix: proposeIx, rosterChange: proposalAccount } =
      buildProposeRosterChangeIx({
        recovery,
        recoveryId,
        rosterChangeIndex,
        payer: creator,
        payloadHash,
        credential,
      });
    rosterChange = proposalAccount;
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

    txSignature = await sendBundle(
      connection,
      creator,
      [stageIx, proposeIx, approveIx, executeIx],
      signTransaction,
      () => progress("sign"),
      () => progress("submit"),
      () => progress("confirm"),
    );
  } else {
    // Passkey mode. Two separate user-signed txs because each carries
    // its own secp256r1 precompile + assertion challenge:
    //   tx A: [stage_payload, precompile-for-propose, propose]   ← passkey tap A
    //   tx B: [precompile-for-approve, approve, execute]         ← passkey tap B
    // Both txs are paid for by the connected wallet (fee payer); the
    // wallet doesn't need to be a roster member.

    // --- propose ---
    progress("propose-passkey");
    const proposeC = rosterChangeProposeChallenge(
      recoveryIdBytes,
      payloadHash,
      rosterChangeIndex,
    );
    const proposeAssertion = await runPasskeySign({
      challenge: proposeC,
      rpId,
    });
    const proposePub = pickRosterPubkey(
      account.members,
      proposeAssertion.candidatePubkeys,
    );
    const { precompileIx: proposePrecompile, credential: proposeCred } =
      proposeAssertion.build(proposePub);

    const { ix: proposeIx, rosterChange: proposalAccount } =
      buildProposeRosterChangeIx({
        recovery,
        recoveryId,
        rosterChangeIndex,
        payer: creator,
        payloadHash,
        credential: proposeCred,
      });
    rosterChange = proposalAccount;

    await sendBundle(
      connection,
      creator,
      [stageIx, proposePrecompile, proposeIx],
      signTransaction,
      () => progress("sign"),
      () => progress("submit"),
      () => progress("confirm"),
    );

    // --- approve + execute ---
    progress("approve-passkey");
    const approveC = rosterChangeApproveChallenge(
      recoveryIdBytes,
      rosterChangeIndex,
    );
    const approveAssertion = await runPasskeySign({
      challenge: approveC,
      rpId,
    });
    const approvePub = pickRosterPubkey(
      account.members,
      approveAssertion.candidatePubkeys,
    );
    const { precompileIx: approvePrecompile, credential: approveCred } =
      approveAssertion.build(approvePub);
    const approverMemberSlot = packMemberSlot(SCHEME_WEBAUTHN, approvePub);

    const { ix: approveIx } = buildApproveRosterChangeIx({
      recovery,
      rosterChange,
      payer: creator,
      memberSlot: approverMemberSlot,
      credential: approveCred,
    });
    const executeIx = buildExecuteRosterChangeIx({
      recovery,
      rosterChange,
      payer: creator,
    });

    txSignature = await sendBundle(
      connection,
      creator,
      [approvePrecompile, approveIx, executeIx],
      signTransaction,
      () => progress("approve-sign"),
      () => progress("approve-confirm"),
      () => progress("approve-confirm"),
    );
  }

  progress("done");
  return { rosterChange, txSignature };
}

function pickRosterPubkey(
  members: Uint8Array[],
  candidates: Uint8Array[],
): Uint8Array {
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
    "The passkey you picked isn't on this vault's roster. Pick a passkey that's enrolled here, or use Wallet sign instead.",
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
