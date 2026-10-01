"use client";
import {
  verifyAgentExecutionDocument,
  assertCanonicalFields,
} from "@/lib/clearsign/agentExecutionDocument";
import {
  executeCanonicalAction,
  rememberExecutionBinding,
  savedExecutionBinding,
  type CanonicalExecutionBinding,
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
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { fetchAgentRiskLedger } from "@/lib/agents/agentRiskLedger";
import {
  buildAgentSettlementClearSign,
  type TrustedAgentSettlementInput,
} from "@/lib/agents/settlementClearSign";
import type { AgentSessionGrant } from "@/lib/agents/types";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { listIntents } from "@/lib/chain/intents";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import { fetchWalletByName } from "@/lib/chain/wallets";
import {
  clearSignProfileForSigner,
  prepareClearSignV4Action,
} from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import { useConnection, useWallet } from "@/lib/wallet";

export interface AgentSettlementProposalResult {
  proposalAddress: string;
  status: "created" | "approved" | "executed";
  txid?: string;
  executionBinding?: CanonicalExecutionBinding;
}

export function useAgentTypedTradeSettlement(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const requestIdentity = useRequestIdentity();
  const { signTypedDescriptor } = useSignWithWallet();

  return useCallback(
    async ({
      session,
      policyHash,
      settlement,
      pending,
      onProposalState,
    }: {
      session: AgentSessionGrant;
      policyHash: string;
      settlement: TrustedAgentSettlementInput;
      pending?: {
        proposalAddress?: string;
        executionBinding?: CanonicalExecutionBinding;
        status?: "created" | "approved" | "executed";
      };
      onProposalState?: (state: AgentSettlementProposalResult) => Promise<void>;
    }): Promise<AgentSettlementProposalResult> => {
      const identity = requestIdentity.capture();
      identity.assertCurrent();
      if (
        session.onchain?.status !== "executed" ||
        session.riskOnchain?.status !== "executed"
      ) {
        throw new Error(
          "Agent session and risk policy must be executed on chain before settlement.",
        );
      }
      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData)
        throw new Error("Couldn't load this shared wallet on chain.");
      if (pending?.proposalAddress) {
        const immutable = savedExecutionBinding(
          connection.rpcEndpoint,
          pending.proposalAddress,
          pending.executionBinding,
        );
        const observed = await executeCanonicalAction({
          expectedActionKind: 14,
          assertAction: (document) =>
            assertCanonicalFields(document, {
              Session: session.id,
              Execution: settlement.requestId,
              "Settlement artifact": settlement.settlementArtifactHash,
            }),
          expectedWallet: walletData.pda.toBase58(),
          connection,
          walletName,
          proposal: pending.proposalAddress,
          binding: immutable,
          accountKey: identity.accountKey,
          assertCurrent: identity.assertCurrent,
        });
        if (
          observed.state === "confirmed" ||
          requestRecovery.executionFor(
            connection.rpcEndpoint,
            pending.proposalAddress,
          )
        ) {
          const result: AgentSettlementProposalResult = {
            proposalAddress: pending.proposalAddress,
            status: observed.state === "confirmed" ? "executed" : "approved",
            txid: observed.txid,
            executionBinding: immutable,
          };
          await onProposalState?.(result);
          identity.assertCurrent();
          return result;
        }
      }
      const ledger = await fetchAgentRiskLedger(
        connection,
        walletData.pda,
        session.id,
      );
      if (!ledger)
        throw new Error("The on-chain agent risk ledger does not exist.");
      const binding = buildAgentSettlementClearSign({
        walletName,
        walletId: walletData.pda.toBase58(),
        sessionId: session.id,
        policyHash,
        ledger,
        settlement,
      });

      if (pending?.proposalAddress) {
        const immutable = savedExecutionBinding(
          connection.rpcEndpoint,
          pending.proposalAddress,
          pending.executionBinding,
        );
        const execution = await executeCanonicalAction({
          expectedActionKind: 14,
          assertAction: (document) =>
            verifyAgentExecutionDocument(14, binding.executor, document),
          expectedWallet: walletData.pda.toBase58(),
          connection,
          walletName,
          proposal: pending.proposalAddress,
          binding: immutable,
          accountKey: identity.accountKey,
          assertCurrent: identity.assertCurrent,
          execute: () =>
            backendApi.executeTypedAgentTradeSettlement(
              walletName,
              pending.proposalAddress!,
              binding.executor,
              { retry: false },
            ),
        });
        const result: AgentSettlementProposalResult = {
          proposalAddress: pending.proposalAddress,
          status:
            execution.state === "confirmed"
              ? "executed"
              : execution.state === "waiting"
                ? "created"
                : "approved",
          txid: execution.txid,
          executionBinding: immutable,
        };
        await onProposalState?.(result);
        identity.assertCurrent();
        return result;
      }

      const intents = await listIntents(
        connection,
        walletData.pda,
        walletData.account.intentIndex,
      );
      const intent = intents.find(
        (item) =>
          item.account?.approved &&
          item.account.intentType === IntentType.Custom &&
          item.account.chainKind === 5 &&
          wallet.pickSigner(item.account.proposers),
      );
      if (!intent?.account)
        throw new Error("No approved intent can propose agent settlement.");
      const proposer = wallet.pickSigner(intent.account.proposers);
      if (!proposer)
        throw new Error(
          "Your connected wallet cannot propose agent settlement.",
        );

      identity.assertCurrent();
      const recovery = requestRecovery.begin({
        walletName,
        endpoint: connection.rpcEndpoint,
        accountKey: identity.accountKey,
        label: "Agent settlement authorization",
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
            throw new Error("Backend did not return a settlement proposal.");
          await onProposalState?.({ proposalAddress, status: "created" });

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
              {
                actor_pubkey: approver.toBase58(),
              },
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
          if (!ready) return { proposalAddress, status: "created" };
          await onProposalState?.({ proposalAddress, status: "approved" });
          const execution = await executeCanonicalAction({
            expectedActionKind: 14,
            assertAction: (document) =>
              verifyAgentExecutionDocument(14, binding.executor, document),
            expectedWallet: walletData.pda.toBase58(),
            connection,
            walletName,
            proposal: proposalAddress,
            binding: prepared,
            accountKey: identity.accountKey,
            assertCurrent: identity.assertCurrent,
            execute: () =>
              backendApi.executeTypedAgentTradeSettlement(
                walletName,
                proposalAddress,
                binding.executor,
                { retry: false },
              ),
          });
          if (execution.state === "confirmed") recovery.complete();
          const result: AgentSettlementProposalResult = {
            proposalAddress,
            status:
              execution.state === "confirmed"
                ? "executed"
                : execution.state === "waiting"
                  ? "created"
                  : "approved",
            txid: execution.txid,
            executionBinding: prepared,
          };
          await onProposalState?.(result);
          identity.assertCurrent();
          return result;
        } catch (cause) {
          throw savedProposalError(dry.proposal_pubkey, cause);
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
