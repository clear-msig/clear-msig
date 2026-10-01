"use client";

import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
import {
  reviewedCreationProposalAddress,
  inlineApprovalOptions,
  assertSubmittedCreation,
} from "@/lib/clearsign/inlineApproval";

// Batch send - one input, one typed proposal.
//
// The shared-wallet equivalent of payroll: a proposer enters a list
// of {recipient, amount} rows, then signs one typed ClearSign action.
// The Solana program verifies the exact recipient list + lamports
// before moving funds, so the UI and program now share one truth.

import { useCallback, useRef, useState } from "react";
import { MAX_BATCH_RECIPIENTS } from "@/lib/sendLimits";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQueryClient } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { ProposalStatus, sha256, toHex } from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { fetchIntent } from "@/lib/chain/intents";
import { fetchProposal } from "@/lib/chain/proposals";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  clearSignProfileForSigner,
  prepareClearSignV4Action,
  type BatchSendPayload,
  type ClearSignIntentInput,
} from "@/lib/clearsign";
import {
  assertPolicyNotDenied,
  resolvePolicyEnforcement,
} from "@/lib/policies/enforce";
import { resolvePersistentSendPolicy } from "@/lib/policies/persistentWalletPolicy";

export interface BatchSendRow {
  /// Recipient label (contact name or shortened address) for status UI.
  label: string;
  /// Solana base58 destination address.
  destination: string;
  /// Amount as the smallest on-chain unit (lamports, 1 SOL = 1e9).
  lamports: string;
}

export interface BatchSendProgress {
  total: number;
  /// Count of rows included in an accepted proposal, not confirmed payments.
  succeeded: number;
  /// Count of rows that errored or were cancelled. The full record
  /// for each lives in `failures`.
  failed: number;
  /// Current preparation, signing, submission, or execution step.
  currentLabel?: string;
  /// Per-row failures so the UI can list "Sarah ($120) - declined"
  /// rather than a single anonymous error toast.
  failures: BatchFailure[];
  /// Once this attempt exits the hook flips this to render the summary.
  done: boolean;
  outcome?: BatchSendOutcome;
  message?: string;
  proposalPdas?: string[];
  executionTxid?: string;
}

export interface BatchFailure {
  row: BatchSendRow;
  message: string;
}

export type BatchSendOutcome =
  | "empty"
  | "cancelled"
  | "created"
  | "execution_submitted"
  | "execution_unknown"
  | "submission_unknown"
  | "failed";

interface BatchSendArgs {
  walletName: string;
  intentIndex: number;
  rows: BatchSendRow[];
}

const BATCH_LOG_KEY = "clear-msig:batches:v1";

export function useBatchSend() {
  const { signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const requestIdentity = useRequestIdentity();
  const { pickSigner } = wallet;
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchSendProgress | null>(null);
  // Admission and cancellation are synchronous and belong to one attempt.
  // React updates (or reset while a wallet popup is open) cannot release it.
  const activeRunRef = useRef<{ cancelled: boolean } | null>(null);

  const sendBatch = useCallback(
    async ({ walletName, intentIndex, rows: inputRows }: BatchSendArgs) => {
      if (activeRunRef.current) {
        throw new Error("A batch send is already in progress.");
      }
      if (inputRows.length === 0) {
        return {
          batchId: null,
          succeeded: 0,
          failed: 0,
          proposalPdas: [],
          outcome: "empty" as BatchSendOutcome,
          message: undefined,
        };
      }
      if (inputRows.length > MAX_BATCH_RECIPIENTS) {
        throw new Error(
          `Batch sends support up to ${MAX_BATCH_RECIPIENTS} recipients at once.`,
        );
      }

      // Keep the signed input stable even if the caller edits its draft while
      // chain reads or wallet signing are pending.
      const identity = requestIdentity.capture();
      const rows = inputRows.map((row) => ({ ...row }));
      const run = { cancelled: false };
      const assertNotCancelled = () => {
        identity.assertCurrent();
        if (run.cancelled) throw new BatchCancelledError();
      };
      activeRunRef.current = run;
      let creationRecovery:
        ReturnType<typeof requestRecovery.begin> | undefined;
      let executionRecovery:
        ReturnType<typeof requestRecovery.begin> | undefined;

      try {
        const batchId = generateBatchId();
        const proposalPdas: string[] = [];
        const failures: BatchFailure[] = [];
        let succeeded = 0;
        let failed = 0;
        let submissionStarted = false;
        let proposalAccepted = false;
        let executionStarted = false;
        let executionTxid: string | undefined;
        let outcome: BatchSendOutcome = "failed";
        let message: string | undefined;
        const showStep = (currentLabel: string) =>
          setProgress({
            total: rows.length,
            succeeded,
            failed,
            failures: [...failures],
            done: false,
            currentLabel,
          });
        showStep("Preparing batch");

        try {
          const walletData = await fetchWalletByName(connection, walletName);
          assertNotCancelled();
          if (!walletData) throw new Error("Couldn't load wallet");
          creationRecovery = requestRecovery.begin({
            walletName,
            endpoint: connection.rpcEndpoint,
            accountKey: identity.accountKey,
            label: "Batch transfer",
            identity: [
              walletData.pda.toBase58(),
              intentIndex,
              rows.map((row) => [row.destination, row.lamports.toString()]),
            ],
          });
          const intentRow = await fetchIntent(
            connection,
            walletData.pda,
            intentIndex,
          );
          assertNotCancelled();
          if (!intentRow.account) {
            throw new Error(
              "Couldn't load this wallet's send rule from chain.",
            );
          }
          const proposerPk = pickSigner(intentRow.account.proposers);
          if (!proposerPk) {
            throw new Error(
              "None of your connected wallets can propose this send.",
            );
          }
          const approverPk = pickSigner(intentRow.account.approvers);
          const actionId = randomActionLabel("sol-batch");
          const nonce = randomActionLabel("nonce");
          const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
          const onchainPolicy = await resolveBatchOnchainPolicy(
            connection,
            walletData.pda,
            walletName,
            rows,
            assertNotCancelled,
          );
          assertNotCancelled();
          const policyCommitment =
            onchainPolicy?.commitmentHex ??
            policyCommitmentHex([
              `wallet:${walletData.pda.toBase58()}`,
              `intent:${intentIndex}`,
              `threshold:${intentRow.account.approvalThreshold}`,
              `proposers:${intentRow.account.proposers.join(",")}`,
              `approvers:${intentRow.account.approvers.join(",")}`,
              `rows:${rows.length}`,
            ]);
          const envelope: ClearSignIntentInput<BatchSendPayload> = {
            kind: "batch_send",
            network: "Solana devnet",
            walletName,
            walletId: walletData.pda.toBase58(),
            actionId,
            nonce,
            expiresAt,
            policyCommitment,
            payload: {
              recipients: rows.map((row) => ({
                recipient: row.destination,
                recipientEncoding: "solana_pubkey",
                amount: lamportsToSol(row.lamports),
                asset: "SOL",
              })),
            },
          };
          const summary = await prepareClearSignV4Action(envelope, {
            intentIndex,
            actorPubkey: proposerPk.toBase58(),
            policyBytesHex: onchainPolicy?.hex,
            deviceProfile: clearSignProfileForSigner(wallet, proposerPk),
          });
          assertNotCancelled();
          const dry = await backendApi.prepare.createTypedProposal(walletName, {
            intent_index: intentIndex,
            action_kind: summary.actionKindCode,
            policy_commitment: summary.policyCommitment,
            payload_hash: summary.payloadHash,
            envelope_hash: summary.envelopeHash,
            action_id: envelope.actionId,
            nonce: envelope.nonce,
            policyBytesHex: onchainPolicy?.hex,
            signable_text: summary.signableText,
            canonical_intent_hex: summary.canonicalIntentHex,
            expiry: formatUnixSigningExpiry(envelope.expiresAt),
            actor_pubkey: proposerPk.toBase58(),
          });
          assertNotCancelled();
          showStep("Signing batch");
          const signed = await signTypedDescriptor(dry, {
            preferSigner: proposerPk,
            expectedTyped: {
              envelopeHash: summary.envelopeHash,
              payloadHash: summary.payloadHash,
              signableText: summary.signableText,
            },
          });
          // A wallet popup cannot be revoked, but its late signature must not
          // authorize a submission after this attempt has been stopped.
          assertNotCancelled();
          showStep("Submitting batch request");
          const expectedProposal = reviewedCreationProposalAddress(
            dry,
            summary,
          );
          creationRecovery.submitting(expectedProposal);
          proposalPdas.push(expectedProposal);
          submissionStarted = true;
          const submitted = await backendApi.submit.createTypedProposal(
            walletName,
            {
              ...signed,
              expiry: dry.expiry,
              intent_index: dry.intent_index,
              action_kind: dry.action_kind,
              policy_commitment: dry.policy_commitment_hex,
              payload_hash: dry.payload_hash_hex,
              envelope_hash: dry.envelope_hash_hex,
              action_id: dry.action_id,
              nonce: dry.nonce,
              policyBytesHex: onchainPolicy?.hex,
              canonical_intent_hex: dry.canonical_intent_hex,
            },
          );
          const proposalPda = assertSubmittedCreation(
            dry,
            summary,
            submitted?.proposal,
          );
          creationRecovery.accepted(proposalPda);
          proposalAccepted = true;
          succeeded = rows.length;
          outcome = "created";
          message =
            "Batch request created. Check Activity for approval and execution status.";
          assertNotCancelled();

          if (proposalPda) {
            const decision = await approveIfNeeded(connection, proposalPda, {
              approvers: intentRow.account.approvers,
              approverPubkey: proposerPk.toBase58(),
              approvalThreshold: intentRow.account.approvalThreshold,
            });
            assertNotCancelled();
            if (decision.needsApproveSignature) {
              if (!approverPk) {
                throw new Error("The batch is waiting for another approver.");
              }
              const approveDry = await backendApi.prepare.approveTypedProposal(
                walletName,
                proposalPda,
                { actor_pubkey: approverPk.toBase58() },
              );
              assertNotCancelled();
              showStep("Signing batch approval");
              const approveSigned = await signTypedDescriptor(
                approveDry,
                inlineApprovalOptions(
                  dry,
                  approveDry,
                  summary,
                  proposalPda,
                  approverPk,
                ),
              );
              assertNotCancelled();
              await backendApi.submit.approveTypedProposal(
                walletName,
                proposalPda,
                {
                  ...approveSigned,
                  expiry: approveDry.expiry,
                },
              );
              assertNotCancelled();
            }

            const status =
              decision.status === ProposalStatus.Approved
                ? ProposalStatus.Approved
                : await refetchProposalStatus(connection, proposalPda);
            assertNotCancelled();
            if (status === ProposalStatus.Approved) {
              showStep("Sending batch");
              executionStarted = true;
              if (
                requestRecovery.executionFor(
                  connection.rpcEndpoint,
                  proposalPda,
                )
              )
                throw new Error(
                  "This request already has an execution attempt. Check its verified status.",
                );
              executionRecovery = requestRecovery.begin({
                walletName,
                endpoint: connection.rpcEndpoint,
                accountKey: identity.accountKey,
                label: "Batch execution",
                identity: ["execute", proposalPda],
                phase: "execution",
              });
              executionRecovery.submitting(proposalPda);
              const executed = await backendApi.executeTypedSolBatchSend(
                walletName,
                proposalPda,
                {
                  payments: rows.map((row) => ({
                    recipient: row.destination,
                    amountLamports: lamportsToSafeNumber(row.lamports),
                  })),
                },
                { retry: false },
              );
              // Once execution was sent, cancellation cannot reverse it. Keep
              // the accepted execution result instead of claiming it stopped.
              executionTxid = solanaSubmissionTxid(executed, {
                proposal: proposalPda,
                path: "typed_sol_batch_send",
                requireProposal: true,
              });
              executionRecovery.accepted(proposalPda, executionTxid);
              outcome = "execution_submitted";
              message =
                "Batch transaction submitted. This is not confirmation that the recipients were paid. Check the existing request for chain status.";
            }
          }
        } catch (err) {
          if (executionStarted) {
            outcome = "execution_unknown";
            message =
              "Execution may have been submitted, but its response could not be verified. Check the existing request before any retry; starting another batch could pay twice.";
          } else if (proposalAccepted) {
            outcome = "created";
            message =
              err instanceof BatchCancelledError
                ? "Stopped before the next step. The batch request was already submitted; check Activity for its status."
                : "Batch request created. Check Activity for approval and execution status before retrying.";
          } else if (submissionStarted) {
            // A lost response is not evidence that chain submission failed.
            // Do not count these rows as safely retryable failures.
            outcome = "submission_unknown";
            message =
              "The batch request may have been submitted. Check Activity before retrying.";
          } else {
            outcome = run.cancelled ? "cancelled" : "failed";
            const failureMessage = run.cancelled
              ? "Stopped before submission. No batch request was submitted."
              : friendlyError(err, "send").title;
            message = failureMessage;
            failures.push(
              ...rows.map((row) => ({ row, message: failureMessage })),
            );
            failed = rows.length;
          }
        }

        if (proposalPdas.length > 0) {
          appendBatchRecord({
            batchId,
            walletName,
            createdAt: Date.now(),
            totalRows: rows.length,
            proposalPdas,
          });
        }
        // Refresh even after an uncertain submission so reconciliation can
        // reveal a proposal whose response was lost.
        void queryClient.invalidateQueries({
          queryKey: ["proposals", walletName],
        });
        void queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
        setProgress({
          total: rows.length,
          succeeded,
          failed,
          failures,
          done: true,
          outcome,
          message,
          proposalPdas: [...proposalPdas],
          executionTxid,
        });
        return {
          batchId,
          succeeded,
          failed,
          proposalPdas,
          outcome,
          message,
          executionTxid,
        };
      } finally {
        creationRecovery?.finish();
        executionRecovery?.finish();
        activeRunRef.current = null;
      }
    },
    [
      signTypedDescriptor,
      queryClient,
      connection,
      pickSigner,
      wallet,
      requestIdentity,
    ],
  );

  const cancel = useCallback(() => {
    if (activeRunRef.current) activeRunRef.current.cancelled = true;
  }, []);
  const reset = useCallback(() => {
    if (!activeRunRef.current) setProgress(null);
  }, []);

  return { sendBatch, progress, cancel, reset };
}

class BatchCancelledError extends Error {
  constructor() {
    super("Batch stopped before the next step.");
    this.name = "BatchCancelledError";
  }
}

async function resolveBatchOnchainPolicy(
  connection: Connection,
  wallet: PublicKey,
  walletName: string,
  rows: BatchSendRow[],
  assertNotCancelled: () => void,
) {
  await Promise.all(
    rows.map(async (row) => {
      const plan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: 0,
        recipient: row.destination,
        ticker: "SOL",
        amountDisplay: lamportsToSol(row.lamports),
      });
      assertPolicyNotDenied(plan, "batch send");
      return plan;
    }),
  );
  assertNotCancelled();
  return resolvePersistentSendPolicy(connection, wallet, walletName, 0);
}

function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

function generateBatchId(): string {
  // 16 hex chars is plenty of entropy to avoid collisions in the
  // local batch log without bloating the storage footprint.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "b_" + toHex(bytes);
}

async function refetchProposalStatus(
  connection: Connection,
  proposalPda: string,
): Promise<ProposalStatus | null> {
  try {
    const account = await fetchProposal(connection, new PublicKey(proposalPda));
    return account?.status ?? null;
  } catch {
    return null;
  }
}

function randomActionLabel(prefix: string): string {
  return `${prefix}:${generateNonceHex()}`;
}

function lamportsToSol(value: string): string {
  const lamports = BigInt(value);
  const whole = lamports / 1_000_000_000n;
  const frac = lamports % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

function lamportsToSafeNumber(value: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is too large for this browser.");
  }
  return Number(parsed);
}

function policyCommitmentHex(parts: string[]): string {
  const writer = new TinyByteWriter();
  writer.pushBytes("clearsig:policy-engine:v2:policy");
  writer.pushU32(parts.length);
  parts.forEach((part) => writer.pushBytes(part));
  return toHex(sha256(writer.bytes()));
}

class TinyByteWriter {
  private chunks: number[] = [];

  pushBytes(value: string | Uint8Array) {
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.pushU32(bytes.length);
    bytes.forEach((byte) => this.chunks.push(byte));
  }

  pushU32(value: number) {
    for (let i = 0; i < 4; i++) this.chunks.push((value >> (8 * i)) & 0xff);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

interface BatchRecord {
  batchId: string;
  walletName: string;
  createdAt: number;
  totalRows: number;
  proposalPdas: string[];
}

/// Read all batch records out of localStorage. Surface elsewhere can
/// look up "is this proposal part of a batch?" by scanning records.
export function listBatches(): BatchRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BATCH_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is BatchRecord => isBatchRecord(r));
  } catch {
    return [];
  }
}

function appendBatchRecord(record: BatchRecord) {
  if (typeof window === "undefined") return;
  try {
    const existing = listBatches();
    const next = [record, ...existing].slice(0, 50);
    window.localStorage.setItem(BATCH_LOG_KEY, JSON.stringify(next));
  } catch {
    // Quota / privacy mode failures aren't worth blocking the send
    // path over - the proposals still landed, we just can't group
    // them in the UI.
  }
}

function isBatchRecord(r: unknown): r is BatchRecord {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.batchId === "string" &&
    typeof o.walletName === "string" &&
    typeof o.createdAt === "number" &&
    typeof o.totalRows === "number" &&
    Array.isArray(o.proposalPdas) &&
    o.proposalPdas.every((p) => typeof p === "string")
  );
}
