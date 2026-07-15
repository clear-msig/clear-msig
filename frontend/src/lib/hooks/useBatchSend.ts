"use client";

// Batch send - one input, one typed proposal.
//
// The shared-wallet equivalent of payroll: a proposer enters a list
// of {recipient, amount} rows, then signs one typed ClearSign action.
// The Solana program verifies the exact recipient list + lamports
// before moving funds, so the UI and program now share one truth.

import { useCallback, useRef, useState } from "react";
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
  prepareClearSignAction,
  type BatchSendPayload,
  type ClearSignEnvelope,
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
  /// Count of rows that landed on chain.
  succeeded: number;
  /// Count of rows that errored or were cancelled. The full record
  /// for each lives in `failures`.
  failed: number;
  /// Label of the row currently in flight ("Sending Sarah…").
  currentLabel?: string;
  /// Per-row failures so the UI can list "Sarah ($120) - declined"
  /// rather than a single anonymous error toast.
  failures: BatchFailure[];
  /// Once the loop fully exits the hook flips this so the caller can
  /// render the summary card.
  done: boolean;
}

export interface BatchFailure {
  row: BatchSendRow;
  message: string;
}

interface BatchSendArgs {
  walletName: string;
  intentIndex: number;
  rows: BatchSendRow[];
}

const BATCH_LOG_KEY = "clear-msig:batches:v1";

export function useBatchSend() {
  const { signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const { pickSigner } = wallet;
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchSendProgress | null>(null);
  /// Cancellation goes through a ref because React state updates are
  /// async - by the time the next iteration reads the flag, a
  /// state-based one would be stale.
  const cancelRef = useRef(false);

  const sendBatch = useCallback(
    async ({ walletName, intentIndex, rows }: BatchSendArgs) => {
      if (rows.length === 0) {
        return { batchId: null, succeeded: 0, failed: 0, proposalPdas: [] };
      }
      if (rows.length > 16) {
        throw new Error("Batch sends support up to 16 recipients at once.");
      }

      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData) throw new Error("Couldn't load wallet");
      const intentRow = await fetchIntent(connection, walletData.pda, intentIndex);
      if (!intentRow.account) {
        throw new Error("Couldn't load this wallet's send rule from chain.");
      }
      const proposerPk = pickSigner(intentRow.account.proposers);
      if (!proposerPk) {
        throw new Error("None of your connected wallets can propose this send.");
      }
      const approverPk = pickSigner(intentRow.account.approvers);

      const batchId = generateBatchId();
      const proposalPdas: string[] = [];
      const failures: BatchFailure[] = [];
      let succeeded = 0;
      let failed = 0;
      cancelRef.current = false;

      setProgress({
        total: rows.length,
        succeeded: 0,
        failed: 0,
        failures: [],
        done: false,
        currentLabel: rows[0]?.label,
      });

      try {
        if (cancelRef.current) {
          throw new Error("Cancelled");
        }
        setProgress({
          total: rows.length,
          succeeded,
          failed,
          failures: [...failures],
          currentLabel: "Preparing batch",
          done: false,
        });

        const actionId = randomActionLabel("sol-batch");
        const nonce = randomActionLabel("nonce");
        const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
        const onchainPolicy = await resolveBatchOnchainPolicy(
          connection,
          walletData.pda,
          walletName,
          rows,
        );
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
        const envelope: ClearSignEnvelope<BatchSendPayload> = {
          version: 3,
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
        const summary = await prepareClearSignAction(envelope, {
          fallback: false,
          deviceProfile: clearSignProfileForSigner(wallet, proposerPk),
        });
        const dry = await backendApi.prepare.createTypedProposal(walletName, {
          intent_index: intentIndex,
          action_kind: summary.actionKindCode,
          policy_commitment: envelope.policyCommitment,
          payload_hash: summary.payloadHash,
          envelope_hash: summary.envelopeHash,
          action_id: envelope.actionId,
          nonce: envelope.nonce,
          policyBytesHex: onchainPolicy?.hex,
          signable_text: summary.signableText,
          expiry: formatUnixSigningExpiry(envelope.expiresAt),
          actor_pubkey: proposerPk.toBase58(),
        });

        if (cancelRef.current) {
          throw new Error("Cancelled");
        }
        setProgress({
          total: rows.length,
          succeeded,
          failed,
          failures: [...failures],
          currentLabel: "Signing batch",
          done: false,
        });
        const signed = await signTypedDescriptor(dry, {
          preferSigner: proposerPk,
          expectedTyped: {
            envelopeHash: summary.envelopeHash,
            payloadHash: summary.payloadHash,
            signableText: summary.signableText,
          },
        });
        const submitted = await backendApi.submit.createTypedProposal(walletName, {
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
        });
        const proposalPda =
          typeof submitted?.proposal === "string" ? submitted.proposal : undefined;
        if (proposalPda) proposalPdas.push(proposalPda);

        if (proposalPda) {
          try {
            const decision = await approveIfNeeded(connection, proposalPda, {
              approvers: intentRow.account.approvers,
              approverPubkey: proposerPk.toBase58(),
              approvalThreshold: intentRow.account.approvalThreshold,
            });
            if (decision.needsApproveSignature) {
              if (!approverPk) {
                throw new Error(
                  "The batch is waiting for another approver.",
                );
              }
              const approveDry = await backendApi.prepare.approveTypedProposal(
                walletName,
                proposalPda,
                { actor_pubkey: approverPk.toBase58() },
              );
              const approveSigned = await signTypedDescriptor(approveDry, {
                preferSigner: approverPk,
              });
              await backendApi.submit.approveTypedProposal(walletName, proposalPda, {
                ...approveSigned,
                expiry: approveDry.expiry,
              });
            }

            const status =
              decision.status === ProposalStatus.Approved
                ? ProposalStatus.Approved
                : (await refetchProposalStatus(connection, proposalPda));
            if (status === ProposalStatus.Approved) {
              setProgress({
                total: rows.length,
                succeeded,
                failed,
                failures: [...failures],
                currentLabel: "Sending batch",
                done: false,
              });
              await backendApi.executeTypedSolBatchSend(walletName, proposalPda, {
                payments: rows.map((row) => ({
                  recipient: row.destination,
                  amountLamports: lamportsToSafeNumber(row.lamports),
                })),
              });
            }
          } catch (innerErr) {
            console.warn(
              "[batch-send] typed batch proposal created but execution is waiting",
              innerErr,
            );
          }
        }
        succeeded = rows.length;
      } catch (err) {
        const fe = friendlyError(err, "send");
        failures.push(...rows.map((row) => ({ row, message: fe.title })));
        failed = rows.length;
      }

      // Stamp the batch locally so /app/wallet can group these
      // proposals under one row instead of N near-identical lines.
      if (proposalPdas.length > 0) {
        appendBatchRecord({
          batchId,
          walletName,
          createdAt: Date.now(),
          totalRows: rows.length,
          proposalPdas,
        });
      }

      // Refresh the inbox + per-wallet proposal list so the new
      // proposals show up immediately on the dashboard.
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });

      setProgress({
        total: rows.length,
        succeeded,
        failed,
        failures,
        done: true,
      });

      return { batchId, succeeded, failed, proposalPdas };
    },
    [signTypedDescriptor, queryClient, connection, pickSigner, wallet],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);
  const reset = useCallback(() => {
    setProgress(null);
    cancelRef.current = false;
  }, []);

  return { sendBatch, progress, cancel, reset };
}

async function resolveBatchOnchainPolicy(
  connection: Connection,
  wallet: PublicKey,
  walletName: string,
  rows: BatchSendRow[],
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
