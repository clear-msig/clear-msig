"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { AgentOwnerApproval, AgentOwnerApprovalInput, AgentSessionGrant, AgentTradeProposal, AgentVaultPolicy, AgentVenueReadiness } from "@/features/agents/domain";
import { formatUsd } from "@/features/agents/ui/start/presentation";
import { saveAgentVenueSettlementProposal, settleAgentVenueExecution, useAgentTypedTradeSettlement } from "@/features/agents/infrastructure/executionClient";

export function useConnectedVenueSettlement({
  walletName,
  policy,
  sessions,
  proposals,
  requests,
  requestOwnerApproval,
  refresh,
}: {
  walletName: string;
  policy: AgentVaultPolicy;
  sessions: AgentSessionGrant[];
  proposals: AgentTradeProposal[];
  requests: NonNullable<AgentVenueReadiness["requests"]>;
  requestOwnerApproval: (
    input: AgentOwnerApprovalInput,
    label?: string,
    mode?: "wallet" | "browser",
  ) => Promise<AgentOwnerApproval | null>;
  refresh: () => Promise<void>;
}) {
  const toast = useToast();
  const settleTypedTrade = useAgentTypedTradeSettlement(walletName);
  const [settlementBusyId, setSettlementBusyId] = useState<string | null>(null);

  const settleConnectedTrade = async (requestId: string) => {
    const request = requests.find((item) => item.id === requestId);
    const proposal = proposals.find((item) => item.id === request?.request.proposalId);
    const session = sessions.find((item) => item.id === proposal?.sessionId);
    if (!request?.id || !proposal || !session) {
      toast.error("The trusted trade, proposal, or on-chain session is missing");
      return;
    }
    setSettlementBusyId(request.id);
    try {
      const approval = await requestOwnerApproval({
        walletName,
        agentId: request.request.agentId,
        action: "close_practice_trade",
        summary: "Close and settle connected practice trade",
        targetType: "execution",
        targetId: request.id,
        details: [
          { label: "Market", value: request.request.market ?? "Connected trade" },
          { label: "Reserved size", value: formatUsd(request.request.notionalUsd ?? "0") },
          { label: "Result", value: "Venue fill will be recorded on chain" },
        ],
      }, "Close and settle", "wallet");
      if (!approval) return;
      const venueResult = await settleAgentVenueExecution({
        walletName,
        agentId: request.request.agentId,
        requestId: request.id,
      });
      if (!venueResult.ok || !venueResult.settlement) {
        toast.error(venueResult.message);
        return;
      }
      const proof = await settleTypedTrade({
        session,
        policyHash: proposal.policyHash ?? session.policyHash ?? policy.policyHash ?? "",
        settlement: venueResult.settlement,
        pending: {
          proposalAddress: venueResult.serverRequest?.settlementProposalAddress,
          status: venueResult.serverRequest?.settlementProposalStatus,
        },
        onProposalState: (next) => saveAgentVenueSettlementProposal({
          walletName,
          agentId: request.request.agentId,
          requestId: request.id!,
          ...next,
        }),
      });
      if (proof.status === "executed") toast.success("Connected trade settled on chain");
      else toast.info("Settlement is waiting for wallet approvals", {
        details: `Proposal ${proof.proposalAddress}`,
      });
      await refresh();
    } catch (error) {
      toast.error("Connected settlement did not complete", {
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSettlementBusyId(null);
    }
  };

  return { settleConnectedTrade, settlementBusyId };
}
