"use client";

// Live subscription to a proposal account's on-chain state.
//
// Uses Solana's `onAccountChange` websocket so the UI animates the
// approval bitmap / status the moment another signer's transaction
// lands . no manual refresh or backend polling required.
//
// Plays nicely with Tanstack Query: the subscription callback writes
// straight into the query cache, so any other component reading
// `["proposal", <pda>]` re-renders automatically.

import { useEffect } from "react";
import { useConnection } from "@/lib/wallet";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseProposal,
  type ProposalAccount,
} from "@/lib/msig";
import { DEFAULT_COMMITMENT } from "@/lib/chain/client";

/// Subscribe to `proposalPda` for as long as the component is mounted.
/// When the account changes, the parsed ProposalAccount is written to
/// the `["proposal", <pda>]` query cache so every consumer updates.
///
/// Pass an empty string / null to disable (e.g. "no proposal selected").
export function useProposalSubscription(proposalPda: string | null | undefined): void {
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!proposalPda || proposalPda.trim().length === 0) return;
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(proposalPda);
    } catch {
      return; // invalid address . parent will likely surface an error separately
    }

    let unsubscribed = false;
    const subId = connection.onAccountChange(
      pubkey,
      (account) => {
        if (unsubscribed) return;
        try {
          const parsed: ProposalAccount = parseProposal(new Uint8Array(account.data));
          queryClient.setQueryData(["proposal", proposalPda], parsed);
        } catch (err) {
          // Wrong disc, removed, or still a zero-byte account slot .
          // nothing to surface, just drop the event.
          if (typeof console !== "undefined") {
            console.debug("useProposalSubscription: parse failed:", err);
          }
        }
      },
      // New-style config object . the string-commitment overload is
      // deprecated in recent @solana/web3.js releases.
      { commitment: DEFAULT_COMMITMENT }
    );

    return () => {
      unsubscribed = true;
      // Errors during teardown are cosmetic . fire-and-forget.
      connection.removeAccountChangeListener(subId).catch(() => {
        /* noop */
      });
    };
  }, [connection, queryClient, proposalPda]);
}
