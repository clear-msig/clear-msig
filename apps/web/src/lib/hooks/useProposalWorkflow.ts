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

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import type { ExecuteProposalInput } from "@/lib/api/types";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  fetchProposal,
  listProposalsForWallet,
  type ProposalWithPda,
} from "@/lib/chain/proposals";
import { type AnyProposalAccount } from "@/lib/msig";
import { useProposalSubscription } from "@/lib/hooks/useProposalSubscription";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";

import { readCanonicalProposalReview } from "@/lib/clearsign/readProposalReview";
import {
  readCancellationContext,
  bindCancellationDescriptor,
  readOwnedProposalContext,
} from "@/lib/clearsign/cancellationReview";
import { submitReviewedVote } from "@/lib/clearsign/submitReviewedVote";
import {
  approvalContextMatches,
  voteIsRecorded,
  type VoteOutcome,
} from "@/lib/clearsign/voteEvidence";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { requestAccountKey } from "@/lib/clearsign/requestIdentity";
import {
  executionKind,
  verifiedExecutionSubmission,
  nativeSolExecutionFromReview,
  type ExecutionOutcome,
} from "@/lib/clearsign/proposalExecution";
import { unvotedMembers } from "@/lib/retail/proposalVotes";
import { bindApprovalDescriptor } from "@/lib/clearsign/proposalReview";

export function useProposalWorkflow(
  walletName: string,
  selectedProposal: string,
) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signDescriptor, signTypedDescriptor } = useSignWithWallet();
  const identity = [
    connection.rpcEndpoint,
    wallet.sessionSubject,
    wallet.publicKey?.toBase58(),
    wallet.dynamicPublicKey?.toBase58(),
    wallet.ledgerPublicKey?.toBase58(),
    selectedProposal,
    walletName,
  ].join("|");
  const lifecycle = useRef({ identity, generation: 0, mounted: true });
  if (lifecycle.current.identity !== identity) {
    lifecycle.current.identity = identity;
    lifecycle.current.generation += 1;
  }
  useEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.generation += 1;
    };
  }, []);
  // Capture per attempt, not per render: StrictMode's setup/cleanup cycle must
  // invalidate pending work without making a fresh click unusable.
  const identityGuard = () => {
    const generation = lifecycle.current.generation;
    if (!lifecycle.current.mounted || lifecycle.current.identity !== identity)
      throw new Error(
        "Account, network or request changed. Start again from the current request.",
      );
    return () => {
      if (
        !lifecycle.current.mounted ||
        lifecycle.current.generation !== generation ||
        lifecycle.current.identity !== identity
      )
        throw new Error(
          "Account, network or request changed. Start again from the current request.",
        );
    };
  };

  // Push live bitmap updates straight into the ["proposal", addr] cache.
  useProposalSubscription(selectedProposal);

  const listQuery = useQuery<ProposalWithPda[]>({
    queryKey: ["proposals", walletName, connection.rpcEndpoint],
    queryFn: async () => {
      const wallet = await fetchWalletByName(connection, walletName);
      if (!wallet) return [];
      return listProposalsForWallet(connection, wallet.pda, wallet.account);
    },
    enabled: walletName.trim().length > 0,
    staleTime: 10_000,
  });

  const detailQuery = useQuery<AnyProposalAccount | null>({
    queryKey: ["proposal", selectedProposal, connection.rpcEndpoint],
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
  const reviewQuery = useQuery({
    queryKey: [
      "canonical-proposal-review",
      selectedProposal,
      walletName,
      connection.rpcEndpoint,
    ],
    queryFn: () =>
      readCanonicalProposalReview(connection, selectedProposal, walletName),
    enabled: Boolean(selectedProposal && walletName),
    retry: false,
    staleTime: 0,
  });
  const approvalInFlight = useRef(false);
  const approveMutation = useMutation({
    mutationFn: async (reviewedId?: string) => {
      const assertIdentity = identityGuard();
      if (approvalInFlight.current)
        throw new Error("An approval is already in progress.");
      approvalInFlight.current = true;
      try {
        if (
          !reviewedId ||
          reviewedId !== reviewQuery.data?.reviewId ||
          reviewQuery.isError
        )
          throw new Error(
            "Open and review the verified action details before approving.",
          );
        const review = await readCanonicalProposalReview(
          connection,
          selectedProposal,
          walletName,
        );
        if (review.reviewId !== reviewedId || review.status !== 0)
          throw new Error(
            "Request or signing authority changed. Refresh and review again.",
          );
        const signerPk = wallet.pickSigner(
          unvotedMembers(
            review.binding.approvers,
            review.binding.approvalBitmap,
          ),
        );
        if (!signerPk)
          throw new Error(
            "None of your connected wallets can approve this request.",
          );
        assertIdentity();
        const actorPubkey = signerPk.toBase58();
        if (
          requestRecovery.voteFor(
            connection.rpcEndpoint,
            selectedProposal,
            actorPubkey,
          )
        )
          throw new Error(
            "A vote by this member may already have been submitted. Check its status before voting again.",
          );
        const dry = await backendApi.prepare.approveTypedProposal(
          walletName,
          selectedProposal,
          { actor_pubkey: actorPubkey },
        );
        bindApprovalDescriptor(review, dry, actorPubkey);
        const current = await readCanonicalProposalReview(
          connection,
          selectedProposal,
          walletName,
        );
        if (current.reviewId !== reviewedId)
          throw new Error(
            "Request changed during preparation. Review again before signing.",
          );
        assertIdentity();
        const signed = await signTypedDescriptor(dry, {
          preferSigner: signerPk,
          expectedTyped: {
            envelopeHash: review.envelopeHash,
            payloadHash: review.payloadHash,
            signableText: review.document,
          },
        });
        const finalReview = await readCanonicalProposalReview(
          connection,
          selectedProposal,
          walletName,
        );
        if (finalReview.reviewId !== reviewedId)
          throw new Error(
            "Request changed while signing. Signature was not submitted; refresh and review again.",
          );
        assertIdentity();
        const voteContext = await readOwnedProposalContext(
          connection,
          selectedProposal,
          walletName,
        );
        assertIdentity();
        if (!voteContext || !approvalContextMatches(review, voteContext))
          throw new Error(
            "Request authority changed before approval submission. Refresh and review again.",
          );
        return await submitReviewedVote({
          context: voteContext,
          actor: actorPubkey,
          vote: "approve",
          endpoint: connection.rpcEndpoint,
          accountKey: requestAccountKey(
            wallet.sessionSubject,
            wallet.publicKey?.toBase58() ?? null,
          ),
          assertCurrent: assertIdentity,
          read: () =>
            readOwnedProposalContext(connection, selectedProposal, walletName),
          submit: () =>
            backendApi.submit.approveTypedProposal(
              walletName,
              selectedProposal,
              { ...signed, expiry: dry.expiry },
            ),
        });
      } finally {
        approvalInFlight.current = false;
      }
    },
    onSuccess: async () => {
      await reviewQuery.refetch();
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const assertIdentity = identityGuard();
      if (approvalInFlight.current)
        throw new Error("A request vote is already in progress.");
      approvalInFlight.current = true;
      try {
        const context = await readCancellationContext(
          connection,
          selectedProposal,
          walletName,
        );
        assertIdentity();
        const signerPk = wallet.pickSigner(
          unvotedMembers(
            context.intent.approvers,
            context.proposal.cancellationBitmap,
          ),
        );
        if (!signerPk)
          throw new Error(
            "No connected member can cancel this request without repeating an existing vote.",
          );
        const actorPubkey = signerPk.toBase58();
        if (
          requestRecovery.voteFor(
            connection.rpcEndpoint,
            selectedProposal,
            actorPubkey,
          )
        )
          throw new Error(
            "A vote by this member may already have been submitted. Check its status before voting again.",
          );
        const checkCurrent = async () => {
          const fresh = await readCancellationContext(
            connection,
            selectedProposal,
            walletName,
          );
          assertIdentity();
          if (fresh.fingerprint !== context.fingerprint)
            throw new Error(
              "Request or cancellation authority changed. Refresh before voting again.",
            );
        };
        if (context.proposal.typed) {
          const dry = await backendApi.prepare.cancelTypedProposal(
            walletName,
            selectedProposal,
            { actor_pubkey: actorPubkey },
          );
          bindCancellationDescriptor(context, dry, actorPubkey);
          await checkCurrent();
          const signed = await signTypedDescriptor(dry, {
            preferSigner: signerPk,
          });
          await checkCurrent();
          return await submitReviewedVote({
            context,
            actor: actorPubkey,
            vote: "cancel",
            endpoint: connection.rpcEndpoint,
            accountKey: requestAccountKey(
              wallet.sessionSubject,
              wallet.publicKey?.toBase58() ?? null,
            ),
            assertCurrent: assertIdentity,
            read: () =>
              readOwnedProposalContext(
                connection,
                selectedProposal,
                walletName,
              ),
            submit: () =>
              backendApi.submit.cancelTypedProposal(
                walletName,
                selectedProposal,
                { ...signed, expiry: dry.expiry },
              ),
          });
        }
        const dry = await backendApi.prepare.cancelProposal(
          walletName,
          selectedProposal,
          { actor_pubkey: actorPubkey },
        );
        bindCancellationDescriptor(context, dry, actorPubkey);
        await checkCurrent();
        const signed = await signDescriptor(dry, { preferSigner: signerPk });
        await checkCurrent();
        return await submitReviewedVote({
          context,
          actor: actorPubkey,
          vote: "cancel",
          endpoint: connection.rpcEndpoint,
          accountKey: requestAccountKey(
            wallet.sessionSubject,
            wallet.publicKey?.toBase58() ?? null,
          ),
          assertCurrent: assertIdentity,
          read: () =>
            readOwnedProposalContext(connection, selectedProposal, walletName),
          submit: () =>
            backendApi.submit.cancelProposal(walletName, selectedProposal, {
              ...signed,
              expiry: dry.expiry,
            }),
        });
      } finally {
        approvalInFlight.current = false;
      }
    },
    onSuccess: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const checkVotesMutation = useMutation({
    mutationFn: async (): Promise<VoteOutcome[]> => {
      const assertIdentity = identityGuard();
      const attempts = requestRecovery.votesFor(
        connection.rpcEndpoint,
        selectedProposal,
      );
      const context = await readOwnedProposalContext(
        connection,
        selectedProposal,
        walletName,
      );
      assertIdentity();
      if (!context)
        throw new Error("Request could not be verified. No vote was retried.");
      return attempts.map((attempt) => {
        const actor = attempt.actor!,
          vote = attempt.vote!;
        const confirmed = voteIsRecorded(
          context,
          attempt.voteContext!,
          actor,
          vote,
        );
        if (confirmed) requestRecovery.resolveVote(attempt.key);
        return {
          state: confirmed ? "confirmed" : "unknown",
          proposal: selectedProposal,
          actor,
          vote,
          txid: attempt.txid,
        };
      });
    },
    onSuccess: async () => {
      await reviewQuery.refetch();
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (
      input: ExecuteProposalInput,
    ): Promise<ExecutionOutcome> => {
      const assertIdentity = identityGuard();
      if (approvalInFlight.current)
        throw new Error("A request action is already in progress.");
      if (
        requestRecovery.executionFor(connection.rpcEndpoint, selectedProposal)
      )
        throw new Error(
          "Execution may already have been submitted. Check this existing request's status before any further action.",
        );
      approvalInFlight.current = true;
      let recovery: ReturnType<typeof requestRecovery.begin> | undefined;
      try {
        const context = await readOwnedProposalContext(
          connection,
          selectedProposal,
          walletName,
        );
        assertIdentity();
        if (!context || context.proposal.status !== 1)
          throw new Error(
            "This verified request is not approved for execution.",
          );
        const { proposal, intent } = context;
        const kind = executionKind(proposal, intent);
        let native: ReturnType<typeof nativeSolExecutionFromReview> | undefined;
        if (
          proposal.typed &&
          proposal.actionKind === 1 &&
          intent.chainKind === 0
        ) {
          const review = await readCanonicalProposalReview(
            connection,
            selectedProposal,
            walletName,
          );
          if (
            reviewQuery.isError ||
            review.reviewId !== reviewQuery.data?.reviewId
          )
            throw new Error(
              "Refresh and review the verified native SOL details before executing.",
            );
          native = nativeSolExecutionFromReview(review, intent.chainKind);
          const fresh = await readCanonicalProposalReview(
            connection,
            selectedProposal,
            walletName,
          );
          assertIdentity();
          if (fresh.reviewId !== review.reviewId || fresh.status !== 1)
            throw new Error(
              "Native SOL request changed. Refresh its exact details before execution.",
            );
        } else if (proposal.typed && ![3, 4, 5].includes(proposal.actionKind))
          throw new Error(
            "This request needs an action-specific recovery executor that is not available on this page. Generic execution cannot perform this action. No execution was submitted; reviewing and cancelling remain available.",
          );
        recovery = requestRecovery.begin({
          walletName,
          endpoint: connection.rpcEndpoint,
          accountKey: requestAccountKey(
            wallet.sessionSubject,
            wallet.publicKey?.toBase58() ?? null,
          ),
          label: "Execution of existing request",
          identity: ["execute", selectedProposal],
          phase: "execution",
        });
        assertIdentity();
        recovery.submitting(selectedProposal);
        const response = native
          ? await backendApi.executeTypedSolSend(
              walletName,
              selectedProposal,
              native,
              { retry: false },
            )
          : proposal.typed
            ? [3, 4, 5].includes(proposal.actionKind)
              ? await backendApi.executeTypedIntentGovernance(
                  walletName,
                  selectedProposal,
                  {},
                  { retry: false },
                )
              : await backendApi.executeTypedProposal(
                  walletName,
                  selectedProposal,
                  { retry: false },
                )
            : await backendApi.executeProposal(
                walletName,
                selectedProposal,
                input,
                { retry: false },
              );
        const txid = verifiedExecutionSubmission(
          response,
          selectedProposal,
          proposal,
          intent,
          native,
        );
        recovery.accepted(selectedProposal, txid);
        assertIdentity();
        let verified = null;
        try {
          verified = await readOwnedProposalContext(
            connection,
            selectedProposal,
            walletName,
          );
        } catch {
          /* submitted is not finalized */
        }
        assertIdentity();
        const confirmed =
          kind !== "external" && verified?.proposal.status === 2;
        if (confirmed) recovery.complete();
        return {
          state: confirmed ? "confirmed" : "submitted",
          proposal: selectedProposal,
          kind,
          txid,
        };
      } catch (cause) {
        if (
          requestRecovery.executionFor(connection.rpcEndpoint, selectedProposal)
        )
          throw new Error(
            `Execution outcome is not confirmed. Request ${selectedProposal} is preserved; check its status before trying anything else. ${cause instanceof Error ? cause.message : "The response was unavailable."}`,
          );
        throw cause;
      } finally {
        recovery?.finish();
        approvalInFlight.current = false;
      }
    },
    onSettled: async () => {
      await detailQuery.refetch();
      await listQuery.refetch();
    },
  });
  const checkExecutionMutation = useMutation({
    mutationFn: async (): Promise<ExecutionOutcome> => {
      const assertIdentity = identityGuard();
      const context = await readOwnedProposalContext(
        connection,
        selectedProposal,
        walletName,
      );
      assertIdentity();
      if (!context)
        throw new Error(
          "Request could not be verified. No execution was retried.",
        );
      const kind = executionKind(context.proposal, context.intent);
      const confirmed = kind !== "external" && context.proposal.status === 2;
      if (confirmed)
        requestRecovery.resolveExecution(
          connection.rpcEndpoint,
          selectedProposal,
        );
      return {
        state: confirmed ? "confirmed" : "unknown",
        proposal: selectedProposal,
        kind,
      };
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
    reviewQuery,
    approveMutation,
    cancelMutation,
    checkVotesMutation,
    voteAttempts: requestRecovery.votesFor(
      connection.rpcEndpoint,
      selectedProposal,
    ),
    executeMutation,
    checkExecutionMutation,
    executionAttempt: requestRecovery.executionFor(
      connection.rpcEndpoint,
      selectedProposal,
    ),
    cleanupMutation,
  };
}
