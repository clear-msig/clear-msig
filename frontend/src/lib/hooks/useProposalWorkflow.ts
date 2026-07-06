"use client";

// Proposal workflow hook.
//
// Reads: direct-RPC. `listQuery` batches every (intent, proposal_index)
// pair into one `getMultipleAccountsInfo`; `detailQuery` is a single
// `getAccountInfo`. Both live-update via `useProposalSubscription` when
// a specific proposal is selected.
//
// Writes: full prepare → sign → submit flow for approve + cancel so
// the on-chain bitmap actually changes when the user taps "Approve" /
// "Decline." (Earlier scaffold only called the prepare step and never
// landed on chain - silently broken.)

import { useMutation, useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { Connection, PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import type { ExecuteProposalInput } from "@/lib/api/types";
import { fetchIntentByPda } from "@/lib/chain/intents";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  fetchProposal,
  listProposalsForWallet,
  type ProposalWithPda,
} from "@/lib/chain/proposals";
import { type AnyProposalAccount } from "@/lib/msig";
import { useProposalSubscription } from "@/lib/hooks/useProposalSubscription";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";

export function useProposalWorkflow(walletName: string, selectedProposal: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signDescriptor, signTypedDescriptor } = useSignWithWallet();

  // Push live bitmap updates straight into the ["proposal", addr] cache.
  useProposalSubscription(selectedProposal);

  const listQuery = useQuery<ProposalWithPda[]>({
    queryKey: ["proposals", walletName],
    queryFn: async () => {
      const wallet = await fetchWalletByName(connection, walletName);
      if (!wallet) return [];
      return listProposalsForWallet(connection, wallet.pda, wallet.account);
    },
    enabled: walletName.trim().length > 0,
    staleTime: 10_000,
  });

  const detailQuery = useQuery<AnyProposalAccount | null>({
    queryKey: ["proposal", selectedProposal],
    queryFn: async () => {
      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(selectedProposal);
      } catch {
        return null;
      }
      return fetchProposal(connection, pubkey);
    },
    enabled: selectedProposal.trim().length > 0,
    staleTime: 10_000,
  });

  // Approve = prepare + sign + submit. Approve / cancel /approve carry
  // a `params_data_hex` that's optional in the PreSignedPayload type
  // (the proposal already holds those bytes on chain), so we let the
  // backend default it.
  const approveMutation = useMutation({
    mutationFn: async () => {
      const { proposal, signerPk } = await resolveProposalSigner({
        connection,
        proposalAddress: selectedProposal,
        pickSigner: wallet.pickSigner,
        action: "approve",
      });
      const actorPubkey = signerPk.toBase58();
      if (proposal.typed) {
        const dry = await backendApi.prepare.approveTypedProposal(
          walletName,
          selectedProposal,
          { actor_pubkey: actorPubkey },
        );
        const signed = await signTypedDescriptor(dry, { preferSigner: signerPk });
        return backendApi.submit.approveTypedProposal(walletName, selectedProposal, {
          ...signed,
          expiry: dry.expiry,
        });
      } else {
        const dry = await backendApi.prepare.approveProposal(
          walletName,
          selectedProposal,
          { actor_pubkey: actorPubkey },
        );
        const signed = await signDescriptor(dry, { preferSigner: signerPk });
        return backendApi.submit.approveProposal(walletName, selectedProposal, {
          ...signed,
          expiry: dry.expiry,
        });
      }
    },
    onSuccess: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { proposal, signerPk } = await resolveProposalSigner({
        connection,
        proposalAddress: selectedProposal,
        pickSigner: wallet.pickSigner,
        action: "decline",
      });
      const actorPubkey = signerPk.toBase58();
      if (proposal.typed) {
        const dry = await backendApi.prepare.cancelTypedProposal(
          walletName,
          selectedProposal,
          { actor_pubkey: actorPubkey },
        );
        const signed = await signTypedDescriptor(dry, { preferSigner: signerPk });
        return backendApi.submit.cancelTypedProposal(walletName, selectedProposal, {
          ...signed,
          expiry: dry.expiry,
        });
      } else {
        const dry = await backendApi.prepare.cancelProposal(
          walletName,
          selectedProposal,
          { actor_pubkey: actorPubkey },
        );
        const signed = await signDescriptor(dry, { preferSigner: signerPk });
        return backendApi.submit.cancelProposal(walletName, selectedProposal, {
          ...signed,
          expiry: dry.expiry,
        });
      }
    },
    onSuccess: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (input: ExecuteProposalInput) => {
      const proposal = await fetchProposal(connection, new PublicKey(selectedProposal));
      if (proposal?.typed) {
        return backendApi.executeTypedProposal(walletName, selectedProposal);
      }
      return backendApi.executeProposal(walletName, selectedProposal, input);
    },
    onSuccess: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => backendApi.cleanupProposal(selectedProposal),
    onSuccess: async () => {
      await listQuery.refetch();
    },
  });

  return {
    listQuery,
    detailQuery,
    approveMutation,
    cancelMutation,
    executeMutation,
    cleanupMutation,
  };
}

async function resolveProposalSigner({
  connection,
  proposalAddress,
  pickSigner,
  action,
}: {
  connection: Connection;
  proposalAddress: string;
  pickSigner: (approvers: readonly string[]) => PublicKey | null;
  action: "approve" | "decline";
}) {
  let proposalPk: PublicKey;
  try {
    proposalPk = new PublicKey(proposalAddress);
  } catch {
    throw new Error("Invalid proposal address.");
  }
  const proposal = await fetchProposal(connection, proposalPk);
  if (!proposal) {
    throw new Error("Couldn't load this request from chain.");
  }
  const intent = await fetchIntentByPda(connection, new PublicKey(proposal.intent));
  if (!intent) {
    throw new Error("Couldn't load this request's signing rule from chain.");
  }
  const signerPk = pickSigner(intent.approvers);
  if (!signerPk) {
    throw new Error(
      `None of your connected wallets can ${action} this request.`,
    );
  }
  return { proposal, intent, signerPk };
}
