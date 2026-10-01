"use client";
import { verifyAgentExecutionDocument } from "@/lib/clearsign/agentExecutionDocument";
import {
  canonicalExecutionBinding,
  executeCanonicalAction,
  rememberExecutionBinding,
  savedExecutionBinding,
} from "@/lib/clearsign/canonicalActionExecution";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";

import {
  inlineApprovalOptions,
  assertSubmittedCreation,
  reviewedCreationProposalAddress,
  savedProposalError,
} from "@/lib/clearsign/inlineApproval";

import { useCallback } from "react";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { buildAgentSessionClearSign } from "@/lib/agents/sessionClearSign";
import type { AgentSessionGrant } from "@/lib/agents/types";
import {
  clearSignProfileForSigner,
  prepareClearSignV4Action,
} from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import { useConnection, useWallet } from "@/lib/wallet";

export function useAgentTypedSessionGrant(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const requestIdentity = useRequestIdentity();
  const { signTypedDescriptor } = useSignWithWallet();

  return useCallback(
    async (
      session: AgentSessionGrant,
      input: { venue: string; market: string; status: "active" | "revoked" },
    ): Promise<AgentSessionGrant> => {
      const identity = requestIdentity.capture();
      identity.assertCurrent();
      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData)
        throw new Error("Couldn't load this shared wallet on chain.");
      const intents = await listIntents(
        connection,
        walletData.pda,
        walletData.account.intentIndex,
      );
      const intent = intents.find(
        (row) =>
          row.account?.approved &&
          row.account.intentType === IntentType.Custom &&
          row.account.chainKind === 5 &&
          wallet.pickSigner(row.account.proposers),
      );
      if (!intent?.account)
        throw new Error("No approved intent can grant this session.");
      const proposer = wallet.pickSigner(intent.account.proposers);
      if (!proposer)
        throw new Error("Your connected wallet cannot propose this session.");

      const binding = buildAgentSessionClearSign(session, {
        walletId: walletData.pda.toBase58(),
        ...input,
      });
      const pending = session.onchain;
      if (pending?.operation === input.status) {
        const result = await executeCanonicalAction({
          expectedActionKind: 12,
          assertAction: (document) =>
            verifyAgentExecutionDocument(12, binding.executor, document),
          expectedWallet: walletData.pda.toBase58(),
          connection,
          walletName,
          proposal: pending.proposalAddress,
          binding: savedExecutionBinding(
            connection.rpcEndpoint,
            pending.proposalAddress,
            pending.executionBinding,
          ),
          accountKey: identity.accountKey,
          assertCurrent: identity.assertCurrent,
          execute: () =>
            backendApi.executeTypedAgentSessionGrant(
              walletName,
              pending.proposalAddress,
              binding.executor,
              { retry: false },
            ),
        });
        const status =
          result.state === "confirmed"
            ? ("executed" as const)
            : result.state === "waiting"
              ? ("created" as const)
              : ("approved" as const);
        const txid = result.txid ?? pending.txid;
        identity.assertCurrent();
        return {
          ...session,
          status:
            input.status === "revoked" && status === "executed"
              ? "revoked"
              : session.status,
          onchain: {
            ...pending,
            operation: input.status,
            status,
            txid,
            updatedAt: Date.now(),
          },
        };
      }
      identity.assertCurrent();
      const recovery = requestRecovery.begin({
        walletName,
        endpoint: connection.rpcEndpoint,
        accountKey: identity.accountKey,
        label: "Agent authorization request",
        identity: [
          binding.envelope.kind,
          binding.envelope.walletId,
          binding.envelope.policyCommitment,
          binding.envelope.payload,
        ],
      });
      try {
        const prepared = await prepareClearSignV4Action(binding.envelope, {
          intentIndex: intent.account.intentIndex,
          actorPubkey: proposer.toBase58(),
          deviceProfile: clearSignProfileForSigner(wallet, proposer),
        });
        const dry = await backendApi.prepare.createTypedProposal(walletName, {
          intent_index: intent.account.intentIndex,
          action_kind: prepared.actionKindCode,
          policy_commitment: prepared.policyCommitment,
          payload_hash: prepared.payloadHash,
          envelope_hash: prepared.envelopeHash,
          action_id: binding.envelope.actionId,
          nonce: binding.envelope.nonce,
          signable_text: prepared.signableText,
          canonical_intent_hex: prepared.canonicalIntentHex,
          expiry: formatUnixSigningExpiry(binding.envelope.expiresAt),
          actor_pubkey: proposer.toBase58(),
        });
        identity.assertCurrent();
        const signed = await signTypedDescriptor(dry, {
          preferSigner: proposer,
          expectedTyped: {
            envelopeHash: prepared.envelopeHash,
            payloadHash: prepared.payloadHash,
            signableText: prepared.signableText,
          },
        });
        identity.assertCurrent();
        recovery.submitting(reviewedCreationProposalAddress(dry, prepared));
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
            canonical_intent_hex: dry.canonical_intent_hex,
          },
        );
        const proposalAddress = assertSubmittedCreation(
          dry,
          prepared,
          stringField(submitted, "proposal"),
        );
        rememberExecutionBinding(
          connection.rpcEndpoint,
          proposalAddress,
          prepared,
        );
        recovery.accepted(proposalAddress);
        identity.assertCurrent();
        try {
          if (!proposalAddress)
            throw new Error("Backend did not return a session proposal.");

          const approver = wallet.pickSigner(intent.account.approvers);
          const decision = await approveIfNeeded(connection, proposalAddress, {
            approvers: intent.account.approvers,
            approverPubkey: approver?.toBase58() ?? null,
            approvalThreshold: intent.account.approvalThreshold,
          });
          if (approver && decision.needsApproveSignature) {
            identity.assertCurrent();
            const approveDry = await backendApi.prepare.approveTypedProposal(
              walletName,
              proposalAddress,
              { actor_pubkey: approver.toBase58() },
            );
            identity.assertCurrent();
            const approveSigned = await signTypedDescriptor(
              approveDry,
              inlineApprovalOptions(
                dry,
                approveDry,
                prepared,
                proposalAddress,
                approver,
              ),
            );
            identity.assertCurrent();
            await backendApi.submit.approveTypedProposal(
              walletName,
              proposalAddress,
              {
                ...approveSigned,
                expiry: approveDry.expiry,
              },
            );
          }

          const ready = await waitForProposalApproval(
            connection,
            proposalAddress,
          );
          let status: "created" | "approved" | "executed" = ready
            ? "approved"
            : "created";
          let txid: string | undefined;
          if (ready) {
            const execution = await executeCanonicalAction({
              expectedActionKind: 12,
              assertAction: (document) =>
                verifyAgentExecutionDocument(12, binding.executor, document),
              expectedWallet: walletData.pda.toBase58(),
              connection,
              walletName,
              proposal: proposalAddress,
              binding: prepared,
              accountKey: identity.accountKey,
              assertCurrent: identity.assertCurrent,
              execute: () =>
                backendApi.executeTypedAgentSessionGrant(
                  walletName,
                  proposalAddress,
                  binding.executor,
                  { retry: false },
                ),
            });
            txid = execution.txid;
            status = execution.state === "confirmed" ? "executed" : "approved";
            if (execution.state === "confirmed") recovery.complete();
          }
          identity.assertCurrent();
          return {
            ...session,
            status:
              input.status === "revoked" && status === "executed"
                ? "revoked"
                : session.status,
            onchain: {
              proposalAddress,
              executionBinding: canonicalExecutionBinding(prepared),
              proposalIndex: Number(dry.proposal_index),
              intentIndex: intent.account.intentIndex,
              operation: input.status,
              status,
              txid,
              updatedAt: Date.now(),
            },
          };
        } catch {
          identity.assertCurrent();
          // The accepted proposal survives wallet cancellation or an unavailable approval/execute step.
          // Return its identity so the caller persists it and retries the existing request.
          const status = "created" as "created" | "approved" | "executed";
          const txid: string | undefined = undefined;
          identity.assertCurrent();
          return {
            ...session,
            status:
              input.status === "revoked" && status === "executed"
                ? "revoked"
                : session.status,
            onchain: {
              proposalAddress,
              executionBinding: canonicalExecutionBinding(prepared),
              proposalIndex: Number(dry.proposal_index),
              intentIndex: intent.account.intentIndex,
              operation: input.status,
              status,
              txid,
              updatedAt: Date.now(),
            },
          };
        }
      } finally {
        recovery.finish();
      }
    },
    [connection, signTypedDescriptor, wallet, walletName, requestIdentity],
  );
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = (value as Record<string, unknown>)[field];
  return typeof row === "string" && row.trim() ? row : undefined;
}
