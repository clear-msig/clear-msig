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
// landed on chain — silently broken.)

import { useMutation, useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { PublicKey } from "@solana/web3.js";
import { backendApi, backendApiLegacy } from "@/lib/api/endpoints";
import type { CreateProposalInput, ExecuteProposalInput } from "@/lib/api/types";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  fetchProposal,
  listProposalsForWallet,
  type ProposalWithPda,
} from "@/lib/chain/proposals";
import { type ProposalAccount } from "@/lib/msig";
import { useProposalSubscription } from "@/lib/hooks/useProposalSubscription";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";

export function useProposalWorkflow(walletName: string, selectedProposal: string) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { signDescriptor } = useSignWithWallet();
  const actorPubkey = publicKey?.toBase58();

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

  const detailQuery = useQuery<ProposalAccount | null>({
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

  const createMutation = useMutation({
    mutationFn: (input: CreateProposalInput) =>
      backendApiLegacy.createProposal(walletName, input),
    onSuccess: async () => {
      await listQuery.refetch();
    },
  });

  // Approve = prepare + sign + submit. Approve / cancel /approve carry
  // a `params_data_hex` that's optional in the PreSignedPayload type
  // (the proposal already holds those bytes on chain), so we let the
  // backend default it.
  const approveMutation = useMutation({
    mutationFn: async () => {
      const dry = await backendApi.prepare.approveProposal(
        walletName,
        selectedProposal,
        { actor_pubkey: actorPubkey },
      );
      const signed = await signDescriptor(dry);
      return backendApi.submit.approveProposal(walletName, selectedProposal, {
        ...signed,
        expiry: dry.expiry,
      });
    },
    onSuccess: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const dry = await backendApi.prepare.cancelProposal(
        walletName,
        selectedProposal,
        { actor_pubkey: actorPubkey },
      );
      const signed = await signDescriptor(dry);
      return backendApi.submit.cancelProposal(walletName, selectedProposal, {
        ...signed,
        expiry: dry.expiry,
      });
    },
    onSuccess: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const executeMutation = useMutation({
    mutationFn: (input: ExecuteProposalInput) =>
      backendApi.executeProposal(walletName, selectedProposal, input),
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
    createMutation,
    approveMutation,
    cancelMutation,
    executeMutation,
    cleanupMutation,
  };
}
