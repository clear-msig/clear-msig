"use client";

import { useCallback } from "react";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { buildAgentRiskPolicyClearSign } from "@/lib/agents/riskPolicyClearSign";
import type { AgentSessionGrant, AgentVaultPolicy } from "@/lib/agents/types";
import { prepareClearSignAction } from "@/lib/clearsign-v2";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType } from "@/lib/msig";
import { useConnection, useWallet } from "@/lib/wallet";

export function useAgentTypedRiskPolicy(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signTypedDescriptor } = useSignWithWallet();

  return useCallback(
    async (
      session: AgentSessionGrant,
      policy: AgentVaultPolicy,
    ): Promise<AgentSessionGrant> => {
      if (session.onchain?.status !== "executed") {
        throw new Error("The on-chain agent session must execute before its risk policy.");
      }
      if (!policy.policyHash) {
        throw new Error("The safety policy is missing its integrity hash.");
      }
      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData) throw new Error("Couldn't load this shared wallet on chain.");
      const intents = await listIntents(
        connection,
        walletData.pda,
        walletData.account.intentIndex,
      );
      const intent = intents.find(
        (row) =>
          row.account?.approved &&
          row.account.intentType === IntentType.Custom &&
          wallet.pickSigner(row.account.proposers),
      );
      if (!intent?.account) throw new Error("No approved intent can set agent risk.");
      const proposer = wallet.pickSigner(intent.account.proposers);
      if (!proposer) throw new Error("Your connected wallet cannot propose agent risk.");

      const binding = buildAgentRiskPolicyClearSign(
        session,
        policy,
        walletData.pda.toBase58(),
      );
      const operation = binding.envelope.payload.status;
      const pending = session.riskOnchain;
      if (
        pending?.operation === operation &&
        pending.policyHash === policy.policyHash &&
        pending.status !== "executed"
      ) {
        const ready = await waitForProposalApproval(connection, pending.proposalAddress);
        let status: "created" | "approved" | "executed" = ready
          ? "approved"
          : "created";
        let txid = pending.txid;
        if (ready) {
          const executed = await backendApi.executeTypedAgentRiskPolicy(
            walletName,
            pending.proposalAddress,
            binding.executor,
          );
          txid = stringField(executed, "txid");
          status = "executed";
        }
        return {
          ...session,
          riskOnchain: { ...pending, status, txid, updatedAt: Date.now() },
        };
      }

      const prepared = await prepareClearSignAction(binding.envelope, { fallback: false });
      const dry = await backendApi.prepare.createTypedProposal(walletName, {
        intent_index: intent.account.intentIndex,
        action_kind: prepared.actionKindCode,
        policy_commitment: binding.envelope.policyCommitment,
        payload_hash: prepared.payloadHash,
        envelope_hash: prepared.envelopeHash,
        action_id: binding.envelope.actionId,
        nonce: binding.envelope.nonce,
        signable_text: prepared.signableText,
        expiry: formatUnixSigningExpiry(binding.envelope.expiresAt),
        actor_pubkey: proposer.toBase58(),
      });
      const signed = await signTypedDescriptor(dry, { preferSigner: proposer });
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
      if (!proposalAddress) throw new Error("Backend did not return a risk proposal.");

      const approver = wallet.pickSigner(intent.account.approvers);
      const decision = await approveIfNeeded(connection, proposalAddress, {
        approvers: intent.account.approvers,
        approverPubkey: approver?.toBase58() ?? null,
        approvalThreshold: intent.account.approvalThreshold,
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

      const ready = await waitForProposalApproval(connection, proposalAddress);
      let status: "created" | "approved" | "executed" = ready
        ? "approved"
        : "created";
      let txid: string | undefined;
      if (ready) {
        const executed = await backendApi.executeTypedAgentRiskPolicy(
          walletName,
          proposalAddress,
          binding.executor,
        );
        txid = stringField(executed, "txid");
        status = "executed";
      }
      return {
        ...session,
        riskOnchain: {
          proposalAddress,
          proposalIndex: Number(dry.proposal_index),
          intentIndex: intent.account.intentIndex,
          policyHash: policy.policyHash,
          operation,
          status,
          txid,
          updatedAt: Date.now(),
        },
      };
    },
    [connection, signTypedDescriptor, wallet, walletName],
  );
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = (value as Record<string, unknown>)[field];
  return typeof row === "string" && row.trim() ? row : undefined;
}
