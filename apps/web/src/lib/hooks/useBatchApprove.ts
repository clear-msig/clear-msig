"use client";

// Batch approve - one decision, N signatures.
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
import { Connection, PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";

import { useConnection, useWallet } from "@/lib/wallet";
import { fetchIntentByPda } from "@/lib/chain/intents";
import { fetchProposal } from "@/lib/chain/proposals";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { friendlyError } from "@/lib/api/errors";

export interface BatchTarget {
  walletName: string;
  proposalPda: string;
  /// Short human label rendered while the row is in flight
  /// (e.g. "Send money in Roommates"). Optional - falls back to
  /// proposalPda if absent.
  label?: string;
}

export interface BatchProgress {
  total: number;
  completed: number;
  /// Set when the loop stopped early - user cancelled or backend
  /// errored. The UI can keep showing the partial result.
  error?: string;
  /// Label of the row currently in flight. Lets the UI render
  /// "Approving Send money in Roommates…" rather than a bare counter.
  currentLabel?: string;
}

export function useBatchApprove() {
  const { signDescriptor, signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const { connection } = useConnection();
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
          const { proposal, signerPk } = await resolveBatchApprovalSigner({
            connection,
            proposalAddress: row.proposalPda,
            pickSigner: wallet.pickSigner,
          });
          const actorPubkey = signerPk.toBase58();
          if (proposal.typed) {
            const dry = await backendApi.prepare.approveTypedProposal(
              row.walletName,
              row.proposalPda,
              { actor_pubkey: actorPubkey },
            );
            const signed = await signTypedDescriptor(dry, {
              preferSigner: signerPk,
            });
            await backendApi.submit.approveTypedProposal(
              row.walletName,
              row.proposalPda,
              { ...signed, expiry: dry.expiry },
            );
          } else {
            const dry = await backendApi.prepare.approveProposal(
              row.walletName,
              row.proposalPda,
              { actor_pubkey: actorPubkey },
            );
            const signed = await signDescriptor(dry, {
              preferSigner: signerPk,
            });
            await backendApi.submit.approveProposal(
              row.walletName,
              row.proposalPda,
              { ...signed, expiry: dry.expiry },
            );
          }
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
      // All approvals landed - refresh the inbox + per-wallet caches.
      touchedWallets.forEach((w) => {
        queryClient.invalidateQueries({ queryKey: ["proposals", w] });
      });
      queryClient.invalidateQueries({ queryKey: ["my-organizations"] });
      return { completed: rows.length, total: rows.length };
    },
    [signDescriptor, signTypedDescriptor, queryClient, connection, wallet.pickSigner],
  );

  const reset = useCallback(() => setProgress(null), []);

  return { approveAll, progress, reset };
}

async function resolveBatchApprovalSigner({
  connection,
  proposalAddress,
  pickSigner,
}: {
  connection: Connection;
  proposalAddress: string;
  pickSigner: (approvers: readonly string[]) => PublicKey | null;
}) {
  let proposalPk: PublicKey;
  try {
    proposalPk = new PublicKey(proposalAddress);
  } catch {
    throw new Error("Invalid request address.");
  }
  const proposal = await fetchProposal(connection, proposalPk);
  if (!proposal) {
    throw new Error("Couldn't load this request from chain.");
  }
  const intent = await fetchIntentByPda(connection, new PublicKey(proposal.intent));
  if (!intent) {
    throw new Error("Couldn't load this request's approval rule from chain.");
  }
  const signerPk = pickSigner(intent.approvers);
  if (!signerPk) {
    throw new Error("None of your connected wallets can approve this request.");
  }
  return { proposal, intent, signerPk };
}
