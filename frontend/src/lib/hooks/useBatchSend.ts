"use client";

// Batch send — one input, N proposals.
//
// The shared-wallet equivalent of payroll: a proposer enters a list
// of {recipient, amount} rows, then signs N times in sequence (Solana
// wallets can't sign multiple messages in one popup yet) so each
// recipient lands as its own SolTransfer proposal. Approvers can then
// clear the whole batch with the existing `useBatchApprove` hook —
// the proposals share a `batchId` (saved per-proposal under the
// `clear-msig:batches` namespace) so the dashboard can group them.
//
// Why N proposals instead of one wide intent: the on-chain SolTransfer
// template fires a single CPI per execution. A program-level batch
// intent type is on the roadmap (one signature per actor for the
// whole bundle); this hook is the v1 that ships against today's
// program without contract changes.

import { useCallback, useRef, useState } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQueryClient } from "@tanstack/react-query";
import type { Connection } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { fromHex, toHex } from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";

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
  /// Per-row failures so the UI can list "Sarah ($120) — declined"
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
  const { signBytes } = useSignWithWallet();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const actorPubkey = publicKey?.toBase58();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchSendProgress | null>(null);
  /// Cancellation goes through a ref because React state updates are
  /// async — by the time the next iteration reads the flag, a
  /// state-based one would be stale.
  const cancelRef = useRef(false);

  const sendBatch = useCallback(
    async ({ walletName, intentIndex, rows }: BatchSendArgs) => {
      if (rows.length === 0) {
        return { batchId: null, succeeded: 0, failed: 0, proposalPdas: [] };
      }

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

      for (let i = 0; i < rows.length; i++) {
        if (cancelRef.current) {
          // Bail — caller hit cancel between rows. Remaining rows
          // get marked as failures so the summary tells the user
          // exactly what didn't go.
          for (let j = i; j < rows.length; j++) {
            failures.push({ row: rows[j], message: "Cancelled" });
            failed += 1;
          }
          break;
        }
        const row = rows[i];
        setProgress({
          total: rows.length,
          succeeded,
          failed,
          failures: [...failures],
          currentLabel: row.label,
          done: false,
        });

        // Each proposal slot on chain is keyed by the wallet's
        // current `proposal_index`. The CLI's `prepare` reads that
        // index from the wallet account every call, so we have to
        // make sure the previous submit has been observed by the RPC
        // before the next prepare runs — otherwise both rows compute
        // the same PDA and the second submit fails with "account
        // already in use." Retry the prepare → sign → submit cycle a
        // few times on transient errors before giving up on the row.
        const result = await runRowWithRetry({
          walletName,
          intentIndex,
          row,
          signBytes,
          actorPubkey,
          connection,
        });

        if (result.kind === "ok") {
          if (result.proposalPda) proposalPdas.push(result.proposalPda);
          succeeded += 1;
        } else {
          failures.push({ row, message: result.message });
          failed += 1;
        }

        setProgress({
          total: rows.length,
          succeeded,
          failed,
          failures: [...failures],
          currentLabel: i + 1 < rows.length ? rows[i + 1].label : undefined,
          done: false,
        });

        // Pause briefly between rows so the next prepare reads the
        // post-submit chain state. 600ms is empirically enough for
        // devnet `confirmed` reads to catch up; tune up if we still
        // see PDA collisions.
        if (i + 1 < rows.length) {
          await sleep(600);
        }
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
    [signBytes, queryClient, actorPubkey],
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

function generateNonceHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + toHex(bytes);
}

const RETRYABLE_HINTS = [
  "already in use",
  "alreadyinitialized",
  "blockhash not found",
  "node is behind",
  "tx simulation failed",
  "expired",
];

interface RowAttemptResult {
  kind: "ok" | "fail";
  message: string;
  proposalPda?: string;
}

interface RowAttemptArgs {
  walletName: string;
  intentIndex: number;
  row: BatchSendRow;
  signBytes: (bytes: Uint8Array) => Promise<{ signer_pubkey: string; signature: string }>;
  actorPubkey: string | undefined;
  connection: Connection;
}

/// Run prepare → sign → submit for one row. Retries on transient
/// chain errors (PDA collision from RPC lag, blockhash not found,
/// "node behind" — see `RETRYABLE_HINTS`) by waiting a beat and
/// rebuilding the message from a fresh prepare. Wallet rejections
/// fail fast — never re-prompt the user without their click.
async function runRowWithRetry(
  { walletName, intentIndex, row, signBytes, actorPubkey, connection }: RowAttemptArgs,
): Promise<RowAttemptResult> {
  const maxAttempts = 3;
  let lastMessage = "Send failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const nonceHex = generateNonceHex();
      const dry = await backendApi.prepare.createProposal(walletName, {
        intent_index: intentIndex,
        params: [
          `destination=${row.destination}`,
          `amount=${row.lamports}`,
          `nonce_value=${nonceHex}`,
        ],
        actor_pubkey: actorPubkey,
      });
      const signed = await signBytes(fromHex(dry.message_hex));
      const submission = await backendApi.submit.createProposal(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: intentIndex,
      });
      const proposalPda =
        typeof submission?.proposal === "string" ? submission.proposal : undefined;

      // Propose may auto-approve on chain (program flips proposer
      // bit when proposer ∈ approvers + threshold met). Skip the
      // approve popup in that case — every saved popup × N rows is
      // a meaningful UX win for a 50-row payroll. Best-effort: if
      // the user rejects mid-batch we still consider the row a
      // success (proposal's on chain, can be approved later).
      if (proposalPda && actorPubkey) {
        try {
          const decision = await approveIfNeeded(connection, proposalPda);
          if (decision.needsApproveSignature) {
            const approveDry = await backendApi.prepare.approveProposal(
              walletName,
              proposalPda,
              { actor_pubkey: actorPubkey },
            );
            const approveSigned = await signBytes(fromHex(approveDry.message_hex));
            await backendApi.submit.approveProposal(walletName, proposalPda, {
              ...approveSigned,
              expiry: approveDry.expiry,
            });
          }
          await backendApi.executeProposal(walletName, proposalPda, {});
        } catch (innerErr) {
          // Per-row partial success — the proposal's on chain even if
          // approve/execute didn't land. Surface in console for
          // debugging without poisoning the rest of the batch.
          console.warn(
            `[batch-send] row ${row.label}: propose ok but approve/execute failed`,
            innerErr,
          );
        }
      }

      return { kind: "ok", message: "ok", proposalPda };
    } catch (err) {
      const fe = friendlyError(err, "send");
      lastMessage = fe.title;
      const raw = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const userRejected =
        raw.includes("user rejected") ||
        raw.includes("user declined") ||
        raw.includes("cancelled the signature") ||
        fe.title.toLowerCase().includes("cancelled");
      if (userRejected) return { kind: "fail", message: lastMessage };
      const retryable = RETRYABLE_HINTS.some((h) => raw.includes(h));
      if (!retryable || attempt === maxAttempts) {
        return { kind: "fail", message: lastMessage };
      }
      // Back off a bit before retrying so the chain catches up.
      await sleep(800 * attempt);
    }
  }
  return { kind: "fail", message: lastMessage };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // path over — the proposals still landed, we just can't group
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
