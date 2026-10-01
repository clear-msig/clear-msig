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
} from "@/lib/clearsign/inlineApproval";

import { useCallback } from "react";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { buildAgentTradeClearSign } from "@/lib/agents/clearsign";
import type { AgentTradePayload, ClearSignIntentInput } from "@/lib/clearsign";
import {
  clearSignProfileForSigner,
  prepareClearSignV4Action,
} from "@/lib/clearsign";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents, type IntentWithPda } from "@/lib/chain/intents";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import { useConnection, useWallet } from "@/lib/wallet";
import type { AgentTradeProposal } from "@/lib/agents/types";
import { listAgentSessions } from "@/features/agents/local-state/store";

export interface AgentTypedClearSignApprovalResult {
  proposal: AgentTradeProposal;
  proposalAddress: string;
  proposalIndex: number;
  intentIndex: number;
  status: "created" | "approved" | "executed";
}

export function useAgentTypedClearSignApproval(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const requestIdentity = useRequestIdentity();
  const { signTypedDescriptor } = useSignWithWallet();

  return useCallback(
    async (
      proposal: AgentTradeProposal,
    ): Promise<AgentTypedClearSignApprovalResult> => {
      const identity = requestIdentity.capture();
      identity.assertCurrent();
      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData) {
        throw new Error("Couldn't load this shared wallet on chain.");
      }
      const intents = await listIntents(
        connection,
        walletData.pda,
        walletData.account.intentIndex,
      );
      const selected = selectAgentProposalIntent(intents, wallet.pickSigner);
      if (!selected?.account) {
        throw new Error(
          "No approved on-chain intent can propose this agent approval with your connected signer.",
        );
      }
      const proposer = wallet.pickSigner(selected.account.proposers);
      if (!proposer) {
        throw new Error(
          "This connected wallet cannot propose agent approvals for this shared wallet.",
        );
      }

      const activeSession = listAgentSessions(walletName).find(
        (session) =>
          session.status === "active" &&
          session.onchain?.status === "executed" &&
          session.expiresAt > Date.now() &&
          (!proposal.policyHash ||
            session.policyHash === proposal.policyHash) &&
          (session.id === proposal.sessionId ||
            session.agentId === proposal.agentId),
      );
      if (!activeSession) {
        throw new Error("This trade has no active on-chain agent session.");
      }
      const binding = buildAgentTradeClearSign(proposal, {
        walletId: walletData.pda.toBase58(),
        sessionId: activeSession.id,
      });
      const envelope: ClearSignIntentInput<AgentTradePayload> = {
        kind: "agent_trade_approval",
        network: "Hyperliquid testnet",
        walletName,
        walletId: binding.walletId,
        actionId: binding.actionId,
        nonce: binding.nonce,
        expiresAt: binding.expiresAt,
        policyCommitment: binding.policyCommitment,
        payload: binding.payload,
      };
      const pending = proposal.clearSignV2?.onchainProposal;
      if (pending) {
        const execution = await executeCanonicalAction({
          expectedActionKind: 9,
          assertAction: (document) =>
            verifyAgentExecutionDocument(9, binding.executor, document),
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
            backendApi.executeTypedAgentTradeApproval(
              walletName,
              pending.proposalAddress,
              binding.executor,
              { retry: false },
            ),
        });
        const status =
          execution.state === "confirmed"
            ? ("executed" as const)
            : execution.state === "waiting"
              ? ("created" as const)
              : ("approved" as const);
        identity.assertCurrent();
        return {
          proposal: {
            ...proposal,
            clearSignV2: {
              ...proposal.clearSignV2!,
              onchainProposal: {
                ...pending,
                status,
                txid: execution.txid ?? pending.txid,
                executedAt: status === "executed" ? Date.now() : undefined,
              },
            },
          },
          proposalAddress: pending.proposalAddress,
          proposalIndex: pending.proposalIndex,
          intentIndex: pending.intentIndex,
          status,
        };
      }
      identity.assertCurrent();
      const recovery = requestRecovery.begin({
        walletName,
        endpoint: connection.rpcEndpoint,
        accountKey: identity.accountKey,
        label: "Agent trade authorization",
        identity: [
          envelope.kind,
          envelope.walletId,
          envelope.policyCommitment,
          envelope.payload,
        ],
      });
      try {
        const summary = await prepareClearSignV4Action(envelope, {
          intentIndex: selected.account.intentIndex,
          actorPubkey: proposer.toBase58(),
          deviceProfile: clearSignProfileForSigner(wallet, proposer),
        });
        const dry = await backendApi.prepare.createTypedProposal(walletName, {
          intent_index: selected.account.intentIndex,
          action_kind: summary.actionKindCode,
          policy_commitment: summary.policyCommitment,
          payload_hash: summary.payloadHash,
          envelope_hash: summary.envelopeHash,
          action_id: binding.actionId,
          nonce: binding.nonce,
          signable_text: summary.signableText,
          canonical_intent_hex: summary.canonicalIntentHex,
          expiry: formatUnixSigningExpiry(binding.expiresAt),
          actor_pubkey: proposer.toBase58(),
        });
        identity.assertCurrent();
        const signed = await signTypedDescriptor(dry, {
          preferSigner: proposer,
          expectedTyped: {
            envelopeHash: summary.envelopeHash,
            payloadHash: summary.payloadHash,
            signableText: summary.signableText,
          },
        });
        identity.assertCurrent();
        recovery.submitting(reviewedCreationProposalAddress(dry, summary));
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
          summary,
          stringField(submitted, "proposal"),
        );
        rememberExecutionBinding(
          connection.rpcEndpoint,
          proposalAddress,
          summary,
        );
        recovery.accepted(proposalAddress);
        identity.assertCurrent();
        try {
          if (!proposalAddress) {
            throw new Error(
              "The on-chain agent approval was created, but no proposal address returned.",
            );
          }

          let status: AgentTypedClearSignApprovalResult["status"] = "created";
          const approver = wallet.pickSigner(selected.account.approvers);
          const approverAddress = approver?.toBase58() ?? null;
          const decision = await approveIfNeeded(connection, proposalAddress, {
            approvers: selected.account.approvers,
            approverPubkey: approverAddress,
            approvalThreshold: selected.account.approvalThreshold,
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
                summary,
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

          const shouldTryExecute = await waitForProposalApproval(
            connection,
            proposalAddress,
          );
          let txid: string | undefined;
          if (shouldTryExecute) {
            const execution = await executeCanonicalAction({
              expectedActionKind: 9,
              assertAction: (document) =>
                verifyAgentExecutionDocument(9, binding.executor, document),
              expectedWallet: walletData.pda.toBase58(),
              connection,
              walletName,
              proposal: proposalAddress,
              binding: summary,
              accountKey: identity.accountKey,
              assertCurrent: identity.assertCurrent,
              execute: () =>
                backendApi.executeTypedAgentTradeApproval(
                  walletName,
                  proposalAddress,
                  binding.executor,
                  { retry: false },
                ),
            });
            txid = execution.txid;
            status =
              execution.state === "confirmed"
                ? "executed"
                : execution.state === "waiting"
                  ? "created"
                  : "approved";
            if (execution.state === "confirmed") recovery.complete();
          }

          const now = Date.now();
          identity.assertCurrent();
          return {
            proposal: {
              ...proposal,
              clearSignV2: {
                ...binding,
                clearSignVersion: 4,
                payloadHash: summary.payloadHash,
                envelopeHash: summary.envelopeHash,
                signableText: summary.signableText,
                onchainProposal: {
                  proposalAddress,
                  executionBinding: canonicalExecutionBinding(summary),
                  proposalIndex: Number(dry.proposal_index),
                  intentIndex: selected.account.intentIndex,
                  status,
                  createdAt: now,
                  executedAt: status === "executed" ? now : undefined,
                  txid,
                },
              },
            },
            proposalAddress,
            proposalIndex: Number(dry.proposal_index),
            intentIndex: selected.account.intentIndex,
            status,
          };
        } catch {
          identity.assertCurrent();
          // The accepted proposal survives wallet cancellation or an unavailable approval/execute step.
          // Return its identity so the caller persists it and retries the existing request.
          const status = "created" as "created" | "approved" | "executed";
          const txid: string | undefined = undefined;
          const now = Date.now();
          identity.assertCurrent();
          return {
            proposal: {
              ...proposal,
              clearSignV2: {
                ...binding,
                clearSignVersion: 4,
                payloadHash: summary.payloadHash,
                envelopeHash: summary.envelopeHash,
                signableText: summary.signableText,
                onchainProposal: {
                  proposalAddress,
                  executionBinding: canonicalExecutionBinding(summary),
                  proposalIndex: Number(dry.proposal_index),
                  intentIndex: selected.account.intentIndex,
                  status,
                  createdAt: now,
                  executedAt: status === "executed" ? now : undefined,
                  txid,
                },
              },
            },
            proposalAddress,
            proposalIndex: Number(dry.proposal_index),
            intentIndex: selected.account.intentIndex,
            status,
          };
        }
      } finally {
        recovery.finish();
      }
    },
    [connection, signTypedDescriptor, wallet, walletName, requestIdentity],
  );
}

function selectAgentProposalIntent(
  intents: IntentWithPda[],
  pickSigner: (pubkeys: readonly string[]) => unknown,
): IntentWithPda | null {
  return (
    intents.find(
      (intent) =>
        intent.account !== null &&
        intent.account.approved &&
        intent.account.intentType === IntentType.Custom &&
        intent.account.chainKind === 5 &&
        pickSigner(intent.account.proposers) !== null,
    ) ?? null
  );
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const next = (value as Record<string, unknown>)[field];
  return typeof next === "string" && next.trim() ? next : undefined;
}
