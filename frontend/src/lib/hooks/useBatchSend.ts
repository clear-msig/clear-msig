"use client";

// Batch send - one input, one proposal.
//
// Rows are encoded into one compact payload and proposed against the
// batch_sol_transfer_v1 intent. The multisig approval bitmap applies
// to the whole bundle, so one approver action clears all rows once
// the wallet threshold is met.

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { toHex } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";

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
const MAX_ROWS = 50;

export function useBatchSend() {
  const { signDescriptor } = useSignWithWallet();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const actorPubkey = publicKey?.toBase58();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchSendProgress | null>(null);

  const sendBatch = useCallback(
    async ({ walletName, intentIndex, rows }: BatchSendArgs) => {
      if (rows.length === 0) {
        return { batchId: null, succeeded: 0, failed: 0, proposalPdas: [] };
      }
      if (rows.length > MAX_ROWS) {
        throw new Error(`A batch can include at most ${MAX_ROWS} rows.`);
      }

      const batchId = generateBatchId();
      const batchPayloadHex = "0x" + toHex(encodeBatchPayload(rows));
      const nonceHex = generateNonceHex();

      setProgress({
        total: rows.length,
        succeeded: 0,
        failed: 0,
        failures: [],
        done: false,
        currentLabel: "Preparing one approval request",
      });

      try {
        const dry = await backendApi.prepare.createProposal(walletName, {
          intent_index: intentIndex,
          params: [
            `batch_payload=${batchPayloadHex}`,
            `nonce_value=${nonceHex}`,
          ],
          actor_pubkey: actorPubkey,
        });
        setProgress({
          total: rows.length,
          succeeded: 0,
          failed: 0,
          failures: [],
          currentLabel: "Waiting for your signature",
          done: false,
        });
        const signed = await signDescriptor(dry);
        const submission = await backendApi.submit.createProposal(walletName, {
          ...signed,
          params_data_hex: dry.params_data_hex,
          expiry: dry.expiry,
          intent_index: intentIndex,
        });
        const proposalPda =
          typeof submission?.proposal === "string" ? submission.proposal : undefined;
        if (!proposalPda) throw new Error("Backend did not return a proposal address.");

        appendBatchRecord({
          batchId,
          walletName,
          createdAt: Date.now(),
          totalRows: rows.length,
          proposalPdas: [proposalPda],
        });

        let executed = false;
        setProgress({
          total: rows.length,
          succeeded: rows.length,
          failed: 0,
          failures: [],
          currentLabel: "Checking approval threshold",
          done: false,
        });

        if (actorPubkey) {
          const decision = await approveIfNeeded(connection, proposalPda);
          if (decision.needsApproveSignature) {
            const approveDry = await backendApi.prepare.approveProposal(
              walletName,
              proposalPda,
              { actor_pubkey: actorPubkey },
            );
            const approveSigned = await signDescriptor(approveDry);
            await backendApi.submit.approveProposal(walletName, proposalPda, {
              ...approveSigned,
              expiry: approveDry.expiry,
            });
          }
          const afterApproval = await approveIfNeeded(connection, proposalPda);
          if (!afterApproval.needsApproveSignature) {
            await backendApi.executeProposal(walletName, proposalPda, {});
            executed = true;
          }
        }

        queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
        queryClient.invalidateQueries({ queryKey: ["my-organizations"] });

        setProgress({
          total: rows.length,
          succeeded: rows.length,
          failed: 0,
          failures: [],
          currentLabel: executed ? "Executed" : "Awaiting remaining approvals",
          done: true,
        });

        return { batchId, succeeded: rows.length, failed: 0, proposalPdas: [proposalPda] };
      } catch (err) {
        const fe = friendlyError(err, "send");
        setProgress({
          total: rows.length,
          succeeded: 0,
          failed: rows.length,
          failures: rows.map((row) => ({ row, message: fe.title })),
          done: true,
        });
        throw err;
      }
    },
    [actorPubkey, connection, queryClient, signDescriptor],
  );

  const cancel = useCallback(() => {}, []);
  const reset = useCallback(() => {
    setProgress(null);
  }, []);

  return { sendBatch, progress, cancel, reset };
}

function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

function encodeBatchPayload(rows: BatchSendRow[]): Uint8Array {
  const payload = new Uint8Array(2 + rows.length * 40);
  payload[0] = rows.length & 0xff;
  payload[1] = (rows.length >> 8) & 0xff;
  rows.forEach((row, index) => {
    const offset = 2 + index * 40;
    const destination = new PublicKey(row.destination).toBytes();
    const lamports = BigInt(row.lamports);
    if (lamports <= 0n || lamports > 0xffff_ffff_ffff_ffffn) {
      throw new Error(`Invalid lamport amount for ${row.label}.`);
    }
    payload.set(destination, offset);
    const view = new DataView(payload.buffer, payload.byteOffset + offset + 32, 8);
    view.setBigUint64(0, lamports, true);
  });
  return payload;
}

function generateBatchId(): string {
  // 16 hex chars is plenty of entropy to avoid collisions in the
  // local batch log without bloating the storage footprint.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "b_" + toHex(bytes);
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
