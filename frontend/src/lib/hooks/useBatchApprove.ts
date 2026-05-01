"use client";

// Batch approve — one decision, N signatures.
//
// Retail users with two or more pending requests in their inbox can
// hit "Approve all" and walk through each wallet sign-prompt in
// sequence instead of opening every request individually. Each sign
// is still required (Solana wallets can't batch signMessage), but
// the cognitive friction collapses from N decisions to one.
//
// State machine:
//   idle → running ({ total, completed, currentLabel })
//        → done ({ total, completed: total }) on success
//        → stopped ({ total, completed: i, error }) on user cancel
//          or backend failure mid-loop.

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { backendApi } from "@/lib/api/endpoints";
import { fromHex } from "@/lib/msig";
import { useWallet } from "@/lib/wallet";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { friendlyError } from "@/lib/api/errors";

export interface BatchTarget {
  walletName: string;
  proposalPda: string;
  /// Short human label rendered while the row is in flight
  /// (e.g. "Send money in Roommates"). Optional — falls back to
  /// proposalPda if absent.
  label?: string;
}

export interface BatchProgress {
  total: number;
  completed: number;
  /// Set when the loop stopped early — user cancelled or backend
  /// errored. The UI can keep showing the partial result.
  error?: string;
  /// Label of the row currently in flight. Lets the UI render
  /// "Approving Send money in Roommates…" rather than a bare counter.
  currentLabel?: string;
}

export function useBatchApprove() {
  const { signBytes } = useSignWithWallet();
  const { publicKey } = useWallet();
  const actorPubkey = publicKey?.toBase58();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<BatchProgress | null>(null);

  const approveAll = useCallback(
    async (rows: BatchTarget[]) => {
      if (rows.length === 0) return { completed: 0, total: 0 };
      setProgress({ total: rows.length, completed: 0 });
      const touchedWallets = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setProgress({
          total: rows.length,
          completed: i,
          currentLabel: row.label ?? row.proposalPda.slice(0, 6),
        });
        try {
          const dry = await backendApi.prepare.approveProposal(
            row.walletName,
            row.proposalPda,
            { actor_pubkey: actorPubkey },
          );
          const signed = await signBytes(fromHex(dry.message_hex));
          await backendApi.submit.approveProposal(
            row.walletName,
            row.proposalPda,
            { ...signed, expiry: dry.expiry },
          );
          touchedWallets.add(row.walletName);
        } catch (err) {
          const fe = friendlyError(err, "approve");
          const message = fe.title;
          setProgress({
            total: rows.length,
            completed: i,
            error: message,
          });
          // Refetch what we did manage to land before bailing out.
          touchedWallets.forEach((w) => {
            queryClient.invalidateQueries({ queryKey: ["proposals", w] });
          });
          return { completed: i, total: rows.length, error: message };
        }
      }

      setProgress({ total: rows.length, completed: rows.length });
      // All approvals landed — refresh the inbox + per-wallet caches.
      touchedWallets.forEach((w) => {
        queryClient.invalidateQueries({ queryKey: ["proposals", w] });
      });
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      return { completed: rows.length, total: rows.length };
    },
    [signBytes, queryClient, actorPubkey],
  );

  const reset = useCallback(() => setProgress(null), []);

  return { approveAll, progress, reset };
}
