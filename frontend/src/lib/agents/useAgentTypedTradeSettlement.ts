"use client";

import { useCallback } from "react";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { fetchAgentRiskLedger } from "@/lib/agents/agentRiskLedger";
import { buildAgentSettlementClearSign, type TrustedAgentSettlementInput } from "@/lib/agents/settlementClearSign";
import type { AgentSessionGrant } from "@/lib/agents/types";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { listIntents } from "@/lib/chain/intents";
import { waitForProposalApproval, waitForProposalStatus } from "@/lib/chain/proposals";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { prepareClearSignAction } from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType, ProposalStatus } from "@/lib/msig";
import { useConnection, useWallet } from "@/lib/wallet";

export interface AgentSettlementProposalResult {
  proposalAddress: string;
  status: "created" | "approved" | "executed";
  txid?: string;
}

export function useAgentTypedTradeSettlement(walletName: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { signTypedDescriptor } = useSignWithWallet();

  return useCallback(async ({
    session,
    policyHash,
    settlement,
    pending,
    onProposalState,
  }: {
    session: AgentSessionGrant;
    policyHash: string;
    settlement: TrustedAgentSettlementInput;
    pending?: { proposalAddress?: string; status?: "created" | "approved" | "executed" };
    onProposalState?: (state: AgentSettlementProposalResult) => Promise<void>;
  }): Promise<AgentSettlementProposalResult> => {
    if (session.onchain?.status !== "executed" || session.riskOnchain?.status !== "executed") {
      throw new Error("Agent session and risk policy must be executed on chain before settlement.");
    }
    const walletData = await fetchWalletByName(connection, walletName);
    if (!walletData) throw new Error("Couldn't load this shared wallet on chain.");
    const ledger = await fetchAgentRiskLedger(connection, walletData.pda, session.id);
    if (!ledger) throw new Error("The on-chain agent risk ledger does not exist.");
    const binding = buildAgentSettlementClearSign({
      walletName,
      walletId: walletData.pda.toBase58(),
      sessionId: session.id,
      policyHash,
      ledger,
      settlement,
    });

    if (pending?.proposalAddress) {
      if (pending.status === "executed") {
        return { proposalAddress: pending.proposalAddress, status: "executed" };
      }
      const chainStatus = await waitForProposalStatus(connection, pending.proposalAddress, {
        accepted: [ProposalStatus.Approved, ProposalStatus.Executed],
      });
      if (chainStatus === ProposalStatus.Executed) {
        const result: AgentSettlementProposalResult = {
          proposalAddress: pending.proposalAddress,
          status: "executed",
        };
        await onProposalState?.(result);
        return result;
      }
      if (chainStatus !== ProposalStatus.Approved) {
        return { proposalAddress: pending.proposalAddress, status: "created" };
      }
      await onProposalState?.({ proposalAddress: pending.proposalAddress, status: "approved" });
      let executed: Record<string, unknown>;
      try {
        executed = await backendApi.executeTypedAgentTradeSettlement(
          walletName,
          pending.proposalAddress,
          binding.executor,
        );
      } catch {
        return { proposalAddress: pending.proposalAddress, status: "approved" };
      }
      const result: AgentSettlementProposalResult = {
        proposalAddress: pending.proposalAddress,
        status: "executed",
        txid: stringField(executed, "txid"),
      };
      await onProposalState?.(result);
      return result;
    }

    const intents = await listIntents(connection, walletData.pda, walletData.account.intentIndex);
    const intent = intents.find((item) =>
      item.account?.approved &&
      item.account.intentType === IntentType.Custom &&
      wallet.pickSigner(item.account.proposers),
    );
    if (!intent?.account) throw new Error("No approved intent can propose agent settlement.");
    const proposer = wallet.pickSigner(intent.account.proposers);
    if (!proposer) throw new Error("Your connected wallet cannot propose agent settlement.");

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
    const signed = await signTypedDescriptor(dry, {
      preferSigner: proposer,
      expectedTyped: {
        envelopeHash: prepared.envelopeHash,
        payloadHash: prepared.payloadHash,
        signableText: prepared.signableText,
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
    if (!proposalAddress) throw new Error("Backend did not return a settlement proposal.");
    await onProposalState?.({ proposalAddress, status: "created" });

    const approver = wallet.pickSigner(intent.account.approvers);
    const decision = await approveIfNeeded(connection, proposalAddress, {
      approvers: intent.account.approvers,
      approverPubkey: approver?.toBase58() ?? null,
      approvalThreshold: intent.account.approvalThreshold,
    });
    if (approver && decision.needsApproveSignature) {
      const approveDry = await backendApi.prepare.approveTypedProposal(walletName, proposalAddress, {
        actor_pubkey: approver.toBase58(),
      });
      const approveSigned = await signTypedDescriptor(approveDry, { preferSigner: approver });
      await backendApi.submit.approveTypedProposal(walletName, proposalAddress, {
        ...approveSigned,
        expiry: approveDry.expiry,
      });
    }
    const ready = await waitForProposalApproval(connection, proposalAddress);
    if (!ready) return { proposalAddress, status: "created" };
    await onProposalState?.({ proposalAddress, status: "approved" });
    let executed: Record<string, unknown>;
    try {
      executed = await backendApi.executeTypedAgentTradeSettlement(
        walletName,
        proposalAddress,
        binding.executor,
      );
    } catch {
      return { proposalAddress, status: "approved" };
    }
    const result: AgentSettlementProposalResult = {
      proposalAddress,
      status: "executed",
      txid: stringField(executed, "txid"),
    };
    await onProposalState?.(result);
    return result;
  }, [connection, signTypedDescriptor, wallet, walletName]);
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = (value as Record<string, unknown>)[field];
  return typeof row === "string" && row.trim() ? row : undefined;
}
