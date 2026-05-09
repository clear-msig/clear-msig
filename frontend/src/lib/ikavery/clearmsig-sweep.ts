"use client";

// In-app sweep flow — the v3e end-to-end path that replaces the v3c
// upstream handoff. Five on-chain or gRPC steps that together move
// SOL from the vault's dWallet to a destination, with the dWallet's
// signature minted by the Ika network at execute time.
//
// Shape:
//   1. propose+approve  one user-signed Solana tx
//   2. execute           one user-signed Solana tx (CPIs into the
//                        Ika dWallet program to register a
//                        MessageApproval PDA for the sweep digest)
//   3. presign           Ika gRPC-Web round trip (Curve25519/EdDSA)
//   4. sign              Ika gRPC-Web round trip — returns a 64-byte
//                        EdDSA signature over the sweep messageBytes
//   5. broadcast         assemble [sig_count, sig, messageBytes] and
//                        send to Solana
//
// Two user popups, three async network legs. The presign+sign roundtrip
// is the one place the user has to wait without a UX prompt.

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";

import { buildProposeIx } from "./ix/propose";
import { buildApproveIx } from "./ix/approve";
import { buildExecuteIx } from "./ix/execute";
import { packMemberSlot, packSolanaMember } from "./credential";
import {
  SCHEME_SOLANA_ADDRESS,
  SCHEME_WEBAUTHN,
} from "./constants";
import {
  CURVE_CURVE25519,
  IKA_DWALLET_PROGRAM_ID,
  SIG_SCHEME_EDDSA_SHA512,
} from "./dwallet/constants";
import {
  coordinatorPda,
  cpiAuthorityPda,
  dwalletPda,
  messageApprovalPda,
} from "./dwallet/pdas";
import { buildSweepMessage, transferSol } from "./sweep/message";
import { buildSolTransferIntent, hashIntents } from "./sweep/intent";
import { fetchVault } from "./clearmsig-actions";
import { loadAttestation } from "./clearmsig-attestations";
import { ikaPresignAndSignCurve25519 } from "./ika-web";
import { IKAVERY_PROGRAM_ID } from "./constants";
import type { AuthCredential } from "./ix/types";
import {
  bundleHashFromDigests,
  proposeChallenge,
  approveChallenge,
} from "./passkey/challenges";
import { runPasskeySign } from "./passkey/sign";

export type SweepStage =
  | "build"
  | "propose-passkey"
  | "propose-approve-sign"
  | "propose-approve-confirm"
  | "approve-passkey"
  | "approve-sign"
  | "approve-confirm"
  | "execute-sign"
  | "execute-confirm"
  | "presign-sign"
  | "broadcast"
  | "broadcast-confirm"
  | "done";

/**
 * Auth mode controls who authorises the proposal + approval.
 *
 *   - "wallet": the connected Solana wallet (must be a member). One
 *     signed tx covers propose + approve. Same flow shipped in v3e.
 *   - "passkey": the user picks a passkey via the OS picker; we run
 *     two assertions (one for propose, one for approve) and bundle
 *     each with its secp256r1 precompile. Two passkey taps + two
 *     wallet popups. The connected wallet pays fees but doesn't need
 *     to be a member — this is the lost-wallet recovery path.
 */
export type SweepAuthMode = "wallet" | "passkey";

export interface SweepParams {
  connection: Connection;
  recovery: PublicKey;
  recoveryId: PublicKey;
  /** Connected wallet — pays fees on every leg. Must be a member only
   *  when authMode === "wallet". */
  creator: PublicKey;
  /** Destination for the sweep — receives the lamports. */
  destination: PublicKey;
  /** Lamports to move from the dWallet. */
  lamports: bigint;
  /** Sign callback — Dynamic's signTransaction wrapped from useWallet(). */
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  /** Auth mode — defaults to "wallet" so legacy callers stay unchanged. */
  authMode?: SweepAuthMode;
  /** Optional RP id for passkey assertions. Defaults to window.location.hostname. */
  rpId?: string;
  /** Optional progress reporter for the wizard. */
  onProgress?: (stage: SweepStage) => void;
}

export interface SweepResult {
  /** Proposal PDA — for explorer deep-links. */
  proposal: PublicKey;
  /** Solana tx sig of the propose+approve bundle. */
  proposeSig: string;
  /** Solana tx sig of the execute (registers MessageApproval). */
  executeSig: string;
  /** Solana tx sig of the actual sweep broadcast — the one that moves funds. */
  broadcastSig: string;
}

/**
 * Run the full in-app sweep. The vault must be a solo (1-of-N) recovery
 * with the dWallet's authority already transferred to ikavery's CPI
 * authority (v3d takes care of that for any vault created from /secure/new).
 */
export async function runInAppSweep(params: SweepParams): Promise<SweepResult> {
  const {
    connection,
    recovery,
    recoveryId,
    creator,
    destination,
    lamports,
    signTransaction,
    authMode = "wallet",
    rpId,
    onProgress,
  } = params;
  const progress = onProgress ?? (() => undefined);

  if (lamports <= 0n) {
    throw new Error("Sweep amount must be greater than zero.");
  }

  // Stage 0: load attestation + verify the recovery is in shape.
  const att = loadAttestation(recovery.toBase58());
  if (!att) {
    throw new Error(
      "No DKG attestation for this vault on this device. Re-mint via /secure/new (or import the saved attestation).",
    );
  }
  if (!att.dwalletAddr) {
    throw new Error(
      "Saved attestation is missing the session id. This vault was created before v3d; re-mint via /secure/new.",
    );
  }
  const dwalletPubkey = new PublicKey(att.publicKey);

  const { account } = await fetchVault(connection, recovery);
  if (account.threshold !== 1) {
    throw new Error(
      `Sweep currently supports solo (1-of-N) vaults only. Threshold: ${account.threshold}`,
    );
  }

  // Stage 1: build the sweep message + structural intent digest. The
  // digest matches what `sweep::intent::hash_message_bytes` would
  // produce on chain, so propose stores the same value the on-chain
  // execute will rebuild and compare against.
  progress("build");
  const sweepIxs = [transferSol(dwalletPubkey, destination, lamports)];
  // proposeMsg here is just for digest computation; the actual on-chain
  // execute uses the freshly-rebuilt finalMsg below.
  buildSweepMessage({
    feePayer: dwalletPubkey,
    instructions: sweepIxs,
  });
  const intent = buildSolTransferIntent(
    dwalletPubkey.toBytes(),
    destination.toBytes(),
    lamports,
  );
  const intentDigest = hashIntents([intent]);

  // Stage 2: propose + approve.
  const proposalIndex = account.proposalCount;
  const recoveryIdBytes = recoveryId.toBytes();
  let proposeSig: string;
  let proposal: PublicKey;

  if (authMode === "wallet") {
    // Wallet mode: SCHEME_SOLANA_ADDRESS for both propose and approve;
    // the on-chain handler matches the credential's pubkey to a tx
    // Signer, so no inline signature needed and we can bundle in one tx.
    const credential: AuthCredential = {
      scheme: SCHEME_SOLANA_ADDRESS,
      pubkey: creator.toBytes(),
    };
    const memberSlot = packSolanaMember(creator);
    const built = buildProposeIx({
      recovery,
      recoveryId,
      proposalIndex,
      proposer: creator,
      intentDigests: [intentDigest],
      userPubkey: dwalletPubkey.toBytes(),
      signatureScheme: SIG_SCHEME_EDDSA_SHA512,
      credential,
    });
    proposal = built.proposal;
    const { ix: approveIx } = buildApproveIx({
      recovery,
      proposal,
      payer: creator,
      memberSlot,
      credential,
    });
    proposeSig = await sendBundle(
      connection,
      creator,
      [built.ix, approveIx],
      signTransaction,
      () => progress("propose-approve-sign"),
      () => progress("propose-approve-confirm"),
    );
  } else {
    // Passkey mode. Two separate user-signed txs because each carries
    // its own secp256r1 precompile + assertion challenge:
    //   tx A: [precompile-for-propose, propose]   ← passkey tap A
    //   tx B: [precompile-for-approve, approve]   ← passkey tap B
    // Both txs are signed by the connected wallet (fee payer); the
    // wallet doesn't need to be a roster member.

    // --- propose ---
    progress("propose-passkey");
    const bundle = bundleHashFromDigests([intentDigest]);
    const proposeC = proposeChallenge(
      recoveryIdBytes,
      bundle,
      proposalIndex,
    );
    const proposeAssertion = await runPasskeySign({
      challenge: proposeC,
      rpId,
    });
    const proposePub = await pickRosterPubkey(
      connection,
      recovery,
      proposeAssertion.candidatePubkeys,
    );
    const { precompileIx: proposePrecompile, credential: proposeCred } =
      proposeAssertion.build(proposePub);
    const built = buildProposeIx({
      recovery,
      recoveryId,
      proposalIndex,
      proposer: creator,
      intentDigests: [intentDigest],
      userPubkey: dwalletPubkey.toBytes(),
      signatureScheme: SIG_SCHEME_EDDSA_SHA512,
      credential: proposeCred,
    });
    proposal = built.proposal;
    proposeSig = await sendBundle(
      connection,
      creator,
      [proposePrecompile, built.ix],
      signTransaction,
      () => progress("propose-approve-sign"),
      () => progress("propose-approve-confirm"),
    );

    // --- approve ---
    progress("approve-passkey");
    const approveC = approveChallenge(recoveryIdBytes, proposalIndex);
    const approveAssertion = await runPasskeySign({
      challenge: approveC,
      rpId,
    });
    const approvePub = await pickRosterPubkey(
      connection,
      recovery,
      approveAssertion.candidatePubkeys,
    );
    const { precompileIx: approvePrecompile, credential: approveCred } =
      approveAssertion.build(approvePub);
    const approveMemberSlot = packMemberSlot(SCHEME_WEBAUTHN, approvePub);
    const { ix: approveIx } = buildApproveIx({
      recovery,
      proposal,
      payer: creator,
      memberSlot: approveMemberSlot,
      credential: approveCred,
    });
    await sendBundle(
      connection,
      creator,
      [approvePrecompile, approveIx],
      signTransaction,
      () => progress("approve-sign"),
      () => progress("approve-confirm"),
    );
  }

  // Stage 3: execute. Rebuilds the message bytes with a fresh blockhash
  // (so the executor doesn't have to scramble for one between propose
  // and execute) and pulls in all dwallet PDAs so the program's CPI to
  // `approve_message` can write the MessageApproval row.
  const { blockhash: sweepBlockhash, lastValidBlockHeight: sweepLastValid } =
    await connection.getLatestBlockhash("confirmed");
  const finalMsg = buildSweepMessage({
    feePayer: dwalletPubkey,
    instructions: sweepIxs,
    recentBlockhash: sweepBlockhash,
  });
  const messageDigest = keccak_256(finalMsg.messageBytes);
  const { pda: messageApproval, bump: messageApprovalBump } =
    messageApprovalPda(
      CURVE_CURVE25519,
      dwalletPubkey.toBytes(),
      SIG_SCHEME_EDDSA_SHA512,
      messageDigest,
    );
  const { pda: dwalletAccount } = dwalletPda(
    CURVE_CURVE25519,
    dwalletPubkey.toBytes(),
  );
  const { pda: coordinator } = coordinatorPda();
  const { pda: cpiAuthority, bump: cpiAuthorityBump } = cpiAuthorityPda(
    IKAVERY_PROGRAM_ID,
  );
  const executeIx = buildExecuteIx({
    recovery,
    proposal,
    payer: creator,
    txIndex: 0,
    messageBytes: finalMsg.messageBytes,
    coordinator,
    messageApproval,
    dwallet: dwalletAccount,
    callerProgram: IKAVERY_PROGRAM_ID,
    cpiAuthority,
    dwalletProgram: IKA_DWALLET_PROGRAM_ID,
    messageApprovalBump,
    cpiAuthorityBump,
  });
  const executeSig = await sendBundle(
    connection,
    creator,
    [executeIx],
    signTransaction,
    () => progress("execute-sign"),
    () => progress("execute-confirm"),
  );

  // Stage 4: gRPC-Web presign + sign. The Ika network signs the sweep
  // messageBytes with the dWallet key; returns a 64-byte EdDSA sig.
  // The Solana tx signature of the execute is passed through as the
  // approval_proof so the network can correlate with the on-chain
  // MessageApproval the previous step wrote.
  progress("presign-sign");
  const sigBytes = await ikaPresignAndSignCurve25519(
    creator.toBytes(),
    {
      attestationData: att.attestationData,
      networkSignature: att.networkSignature,
      networkPubkey: att.networkPubkey,
    },
    finalMsg.messageBytes,
    bs58.decode(executeSig),
  );
  if (sigBytes.length !== 64) {
    throw new Error(
      `expected 64-byte EdDSA signature from Ika sign, got ${sigBytes.length}`,
    );
  }

  // Stage 5: broadcast. The sweep tx wire format is
  // `[sig_count(1), sig(64), ...messageBytes]` — only one signer
  // (the dWallet), and we have its sig from gRPC.
  progress("broadcast");
  const sweepTxBytes = new Uint8Array(1 + 64 + finalMsg.messageBytes.length);
  sweepTxBytes[0] = 1;
  sweepTxBytes.set(sigBytes, 1);
  sweepTxBytes.set(finalMsg.messageBytes, 1 + 64);
  const sweepTx = VersionedTransaction.deserialize(sweepTxBytes);
  const broadcastSig = await connection.sendRawTransaction(sweepTx.serialize(), {
    skipPreflight: true,
  });
  progress("broadcast-confirm");
  await connection.confirmTransaction(
    {
      signature: broadcastSig,
      blockhash: sweepBlockhash,
      lastValidBlockHeight: sweepLastValid,
    },
    "confirmed",
  );

  progress("done");
  return { proposal, proposeSig, executeSig, broadcastSig };
}

/**
 * Match each ECDSA-recovered candidate against the on-chain roster's
 * SCHEME_WEBAUTHN slots and return the one that's actually a member.
 * Throws if neither candidate matches — that means the user picked a
 * passkey that isn't enrolled in this vault.
 */
async function pickRosterPubkey(
  connection: Connection,
  recovery: PublicKey,
  candidates: Uint8Array[],
): Promise<Uint8Array> {
  const { account } = await fetchVault(connection, recovery);
  for (const cand of candidates) {
    const slot = packMemberSlot(SCHEME_WEBAUTHN, cand);
    for (const memberSlot of account.members) {
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
  ixs: import("@solana/web3.js").TransactionInstruction[],
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>,
  onSign: () => void,
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
