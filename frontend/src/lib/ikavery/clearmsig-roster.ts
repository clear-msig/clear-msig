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
// quorum):
//   - Staging payload has additions=[], removals=[], threshold=newN.
//   - The connected wallet can auth the proposer vote when it is on
//     the roster; passkey mode uses a WebAuthn assertion + precompile.
//   - Threshold=1 can still bundle the proposer approval + execute.
//   - Higher thresholds split after the proposer approval so the page
//     can gather the remaining member votes before execute.
//
// Two auth modes:
//
//   "wallet"  — connected Solana wallet IS a roster member; credential
//               is SCHEME_SOLANA_ADDRESS (no inline sig).
//   "passkey" — connected wallet pays fees but isn't a member; an
//               existing passkey on this device is. Two passkey taps
//               (one per challenge) + secp256r1 precompiles. The
//               "lost wallet, lock down via passkey" path.
//
// Both modes split stage + propose into separate txs because the
// staging payload is wide enough to push the bundle over Solana's
// packet cap. The final proposer approval is bundled with execute only
// when the threshold is already satisfied after that vote.

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
import { decodeRosterChangeProposal } from "./codec/roster-change";
import {
  rosterChangePayloadHash,
  rosterChangeProposeChallenge,
  rosterChangeApproveChallenge,
} from "./passkey/challenges";
import { runPasskeySign } from "./passkey/sign";
import type { AuthCredential } from "./ix/types";
import { approvalPda, memberIdHash } from "./pda";

export type BumpAuthMode = "wallet" | "passkey";

export type BumpThresholdStage =
  | "build"
  // Stage tx (no auth, no precompile)
  | "stage-sign"
  | "stage-confirm"
  // Propose tx (passkey mode runs `propose-passkey` first for the assertion)
  | "propose-passkey"
  | "sign"
  | "submit"
  | "confirm"
  // Initial proposer approval tx (passkey mode runs `approve-passkey` first)
  | "approve-passkey"
  | "approve-sign"
  | "approve-submit"
  | "approve-confirm"
  // Higher-threshold bumps pause here while the page gathers the
  // remaining distinct approvals.
  | "collecting-approvals"
  // Final execute tx once the proposal is approved.
  | "execute-sign"
  | "execute-confirm"
  | "done";

export interface AdditionalApprovalsRequest {
  proposal: PublicKey;
  currentCount: number;
  threshold: number;
}

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
  collectAdditionalApprovals?: (
    req: AdditionalApprovalsRequest,
  ) => Promise<void>;
}

export interface BumpThresholdResult {
  rosterChange: PublicKey;
  txSignature: string;
}

/**
 * Bump a vault's threshold on chain.
 *
 * Stage always gets its own tx because the payload is wide. Propose
 * always gets its own tx. The proposer approval is either bundled with
 * execute when the new quorum is already satisfied, or emitted as a
 * standalone tx when the page needs to collect more votes first.
 *
 * The caller can pass `collectAdditionalApprovals` to pause after the
 * proposer vote and gather the remaining approvals before execute.
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
    collectAdditionalApprovals,
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

  // --- Tx A: stage (no auth, same shape in both modes) ---
  await sendBundle(
    connection,
    creator,
    [stageIx],
    signTransaction,
    () => progress("stage-sign"),
    () => progress("stage-confirm"),
    () => progress("stage-confirm"),
  );

  let rosterChange: PublicKey;
  let txSignature: string;

  if (authMode === "wallet") {
    // Wallet mode: SCHEME_SOLANA_ADDRESS for both propose and approve;
    // matching is by Signer-set membership in the same tx, so no
    // precompile or inline sig is needed.
    const credential: AuthCredential = {
      scheme: SCHEME_SOLANA_ADDRESS,
      pubkey: creator.toBytes(),
    };

    // --- Tx B: propose ---
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
    await sendBundle(
      connection,
      creator,
      [proposeIx],
      signTransaction,
      () => progress("sign"),
      () => progress("submit"),
      () => progress("confirm"),
    );

    const { ix: approveIx } = buildApproveRosterChangeIx({
      recovery,
      rosterChange,
      payer: creator,
      memberSlot: creatorSlot,
      credential,
    });

    if (account.threshold === 1) {
      const executeIx = buildExecuteRosterChangeIx({
        recovery,
        rosterChange,
        payer: creator,
      });
      txSignature = await sendBundle(
        connection,
        creator,
        [approveIx, executeIx],
        signTransaction,
        () => progress("approve-sign"),
        () => progress("approve-submit"),
        () => progress("approve-confirm"),
      );
    } else {
      txSignature = await sendBundle(
        connection,
        creator,
        [approveIx],
        signTransaction,
        () => progress("approve-sign"),
        () => progress("approve-submit"),
        () => progress("approve-confirm"),
      );

      let approvalCount = await readRosterChangeApprovalCount(
        connection,
        rosterChange,
      );
      if (approvalCount < account.threshold) {
        if (!collectAdditionalApprovals) {
          throw new Error(
            `Vault threshold is ${account.threshold}; higher-threshold bumps require the page to collect the remaining approvals.`,
          );
        }
        progress("collecting-approvals");
        await collectAdditionalApprovals({
          proposal: rosterChange,
          currentCount: approvalCount,
          threshold: account.threshold,
        });
        approvalCount = await readRosterChangeApprovalCount(
          connection,
          rosterChange,
        );
        if (approvalCount < account.threshold) {
          throw new Error(
            `Threshold bump aborted: collected ${approvalCount} of ${account.threshold} required approvals.`,
          );
        }
      }

      const executeIx = buildExecuteRosterChangeIx({
        recovery,
        rosterChange,
        payer: creator,
      });
      txSignature = await sendBundle(
        connection,
        creator,
        [executeIx],
        signTransaction,
        () => progress("execute-sign"),
        undefined,
        () => progress("execute-confirm"),
      );
    }
  } else {
    // Passkey mode. Each user-auth tx carries its own secp256r1
    // precompile + assertion challenge:
    //   tx B: [precompile-for-propose, propose]    ← passkey tap A
    //   tx C: [precompile-for-approve, approve, execute] ← passkey tap B
    // The connected wallet pays fees on every leg; doesn't need to be
    // a roster member.

    // --- Tx B: passkey assertion + propose ---
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
      [proposePrecompile, proposeIx],
      signTransaction,
      () => progress("sign"),
      () => progress("submit"),
      () => progress("confirm"),
    );

    // --- Tx C: passkey assertion + approve ---
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
    if (account.threshold === 1) {
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
        () => progress("approve-submit"),
        () => progress("approve-confirm"),
      );
    } else {
      txSignature = await sendBundle(
        connection,
        creator,
        [approvePrecompile, approveIx],
        signTransaction,
        () => progress("approve-sign"),
        () => progress("approve-submit"),
        () => progress("approve-confirm"),
      );

      let approvalCount = await readRosterChangeApprovalCount(
        connection,
        rosterChange,
      );
      if (approvalCount < account.threshold) {
        if (!collectAdditionalApprovals) {
          throw new Error(
            `Vault threshold is ${account.threshold}; higher-threshold bumps require the page to collect the remaining approvals.`,
          );
        }
        progress("collecting-approvals");
        await collectAdditionalApprovals({
          proposal: rosterChange,
          currentCount: approvalCount,
          threshold: account.threshold,
        });
        approvalCount = await readRosterChangeApprovalCount(
          connection,
          rosterChange,
        );
        if (approvalCount < account.threshold) {
          throw new Error(
            `Threshold bump aborted: collected ${approvalCount} of ${account.threshold} required approvals.`,
          );
        }
      }

      const executeIx = buildExecuteRosterChangeIx({
        recovery,
        rosterChange,
        payer: creator,
      });
      txSignature = await sendBundle(
        connection,
        creator,
        [executeIx],
        signTransaction,
        () => progress("execute-sign"),
        undefined,
        () => progress("execute-confirm"),
      );
    }
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
  onSubmit: (() => void) | undefined,
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
  if (onSubmit) onSubmit();
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

export interface AddRosterChangeApprovalParams {
  connection: Connection;
  recovery: PublicKey;
  rosterChange: PublicKey;
  /** Pays the fee. Must be a Signer on the tx but doesn't need to be a member. */
  payer: PublicKey;
  authMode: BumpAuthMode;
  walletPubkey?: PublicKey;
  rpId?: string;
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
}

export interface AddRosterChangeApprovalResult {
  txSignature: string;
}

export async function addRosterChangeApproval(
  params: AddRosterChangeApprovalParams,
): Promise<AddRosterChangeApprovalResult> {
  const {
    connection,
    recovery,
    rosterChange,
    payer,
    authMode,
    walletPubkey,
    rpId,
    signTransaction,
  } = params;

  const proposalAccount = await readRosterChangeProposalOrThrow(
    connection,
    rosterChange,
  );
  const { account: vault } = await fetchVault(connection, recovery);

  if (authMode === "wallet") {
    if (!walletPubkey) {
      throw new Error("walletPubkey required when authMode is 'wallet'");
    }
    const slot = packSolanaMember(walletPubkey);
    const onRoster = vault.members.some((m) => bytesEqual(m, slot));
    if (!onRoster) {
      throw new Error(
        "Connected wallet isn't on this vault's roster — pick a different credential.",
      );
    }
    if (await alreadyApproved(connection, rosterChange, slot)) {
      throw new Error(
        "This wallet has already voted on this roster change — pick a different credential.",
      );
    }
    const credential: AuthCredential = {
      scheme: SCHEME_SOLANA_ADDRESS,
      pubkey: walletPubkey.toBytes(),
    };
    const { ix: approveIx } = buildApproveRosterChangeIx({
      recovery,
      rosterChange,
      payer,
      memberSlot: slot,
      credential,
    });
    const sig = await sendBundle(
      connection,
      payer,
      [approveIx],
      signTransaction,
      () => undefined,
      undefined,
      () => undefined,
    );
    return { txSignature: sig };
  }

  const recoveryIdBytes = vault.recoveryId.toBytes();
  const approveC = rosterChangeApproveChallenge(
    recoveryIdBytes,
    proposalAccount.rosterChangeIndex,
  );
  const assertion = await runPasskeySign({ challenge: approveC, rpId });
  const pub = pickRosterPubkey(vault.members, assertion.candidatePubkeys);
  const memberSlot = packMemberSlot(SCHEME_WEBAUTHN, pub);
  if (await alreadyApproved(connection, rosterChange, memberSlot)) {
    throw new Error(
      "That passkey has already voted on this roster change — tap a different one.",
    );
  }
  const { precompileIx, credential } = assertion.build(pub);
  const { ix: approveIx } = buildApproveRosterChangeIx({
    recovery,
    rosterChange,
    payer,
    memberSlot,
    credential,
  });
  const sig = await sendBundle(
    connection,
    payer,
    [precompileIx, approveIx],
    signTransaction,
    () => undefined,
    undefined,
    () => undefined,
  );
  return { txSignature: sig };
}

export async function readRosterChangeApprovalCount(
  connection: Connection,
  rosterChange: PublicKey,
): Promise<number> {
  const acc = await readRosterChangeProposalOrThrow(connection, rosterChange);
  return acc.approvalCount;
}

async function alreadyApproved(
  connection: Connection,
  rosterChange: PublicKey,
  memberSlot: Uint8Array,
): Promise<boolean> {
  const memberHash = memberIdHash(memberSlot);
  const approvalAddr = approvalPda(rosterChange, memberHash);
  const info = await connection.getAccountInfo(approvalAddr, "confirmed");
  return !!info && info.data.length > 0;
}

async function readRosterChangeProposalOrThrow(
  connection: Connection,
  rosterChange: PublicKey,
) {
  const info = await connection.getAccountInfo(rosterChange, "confirmed");
  if (!info || info.data.length === 0) {
    throw new Error(`Roster change account ${rosterChange.toBase58()} not found`);
  }
  return decodeRosterChangeProposal(new Uint8Array(info.data));
}
