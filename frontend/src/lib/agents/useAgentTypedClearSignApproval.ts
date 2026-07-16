"use client";

import { useCallback } from "react";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { buildAgentTradeClearSign } from "@/lib/agents/clearsign";
import type { AgentTradePayload, ClearSignEnvelope } from "@/lib/clearsign";
import {
  clearSignActionKindCode,
  clearSignProfileForSigner,
  prepareClearSignAction,
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
  const { signTypedDescriptor } = useSignWithWallet();

  return useCallback(
    async (
      proposal: AgentTradeProposal,
    ): Promise<AgentTypedClearSignApprovalResult> => {
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
          (!proposal.policyHash || session.policyHash === proposal.policyHash) &&
          (session.id === proposal.sessionId || session.agentId === proposal.agentId),
      );
      if (!activeSession) {
        throw new Error("This trade has no active on-chain agent session.");
      }
      const binding = buildAgentTradeClearSign(proposal, {
        walletId: walletData.pda.toBase58(),
        sessionId: activeSession.id,
        deviceProfile: clearSignProfileForSigner(wallet, proposer),
      });
      const envelope: ClearSignEnvelope<AgentTradePayload> = {
        version: 3,
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
      const summary = await prepareClearSignAction(envelope, {
        fallback: false,
        deviceProfile: clearSignProfileForSigner(wallet, proposer),
      });
      if (
        summary.payloadHash !== binding.payloadHash ||
        summary.envelopeHash !== binding.envelopeHash
      ) {
        throw new Error(
          "Agent ClearSign proof changed while preparing the on-chain proposal.",
        );
      }

      const dry = await backendApi.prepare.createTypedProposal(walletName, {
        intent_index: selected.account.intentIndex,
        action_kind: clearSignActionKindCode("agent_trade_approval"),
        policy_commitment: binding.policyCommitment,
        payload_hash: binding.payloadHash,
        envelope_hash: binding.envelopeHash,
        action_id: binding.actionId,
        nonce: binding.nonce,
        signable_text: binding.signableText,
        expiry: formatUnixSigningExpiry(binding.expiresAt),
        actor_pubkey: proposer.toBase58(),
      });
      const signed = await signTypedDescriptor(dry, {
        preferSigner: proposer,
        expectedTyped: {
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          signableText: summary.signableText,
        },
      });
      const submitted = await backendApi.submit.createTypedProposal(walletName, {
        ...signed,
        expiry: dry.expiry,
        intent_index: dry.intent_index,
        action_kind: dry.action_kind,
        policy_commitment: dry.policy_commitment_hex,
        payload_hash: dry.payload_hash_hex,
        envelope_hash: dry.envelope_hash_hex,
        action_id: dry.action_id,
        nonce: dry.nonce,
      });
      const proposalAddress = stringField(submitted, "proposal");
      if (!proposalAddress) {
        throw new Error("The on-chain agent approval was created, but no proposal address returned.");
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
        const approveDry = await backendApi.prepare.approveTypedProposal(
          walletName,
          proposalAddress,
          { actor_pubkey: approver.toBase58() },
        );
        const approveSigned = await signTypedDescriptor(approveDry, {
          preferSigner: approver,
        });
        await backendApi.submit.approveTypedProposal(walletName, proposalAddress, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      const shouldTryExecute = await waitForProposalApproval(
        connection,
        proposalAddress,
      );
      let txid: string | undefined;
      if (shouldTryExecute) {
        try {
          const executed = await backendApi.executeTypedAgentTradeApproval(
            walletName,
            proposalAddress,
            binding.executor,
          );
          txid = stringField(executed, "txid");
          status = "executed";
        } catch {
          status = "approved";
        }
      }

      const now = Date.now();
      return {
        proposal: {
          ...proposal,
          clearSignV2: {
            ...binding,
            onchainProposal: {
              proposalAddress,
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
    },
    [connection, signTypedDescriptor, wallet, walletName],
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
        pickSigner(intent.account.proposers) !== null,
    ) ?? null
  );
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const next = (value as Record<string, unknown>)[field];
  return typeof next === "string" && next.trim() ? next : undefined;
}
