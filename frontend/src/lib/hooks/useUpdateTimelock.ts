"use client";

// Update an existing intent's timelock_seconds via typed ClearSign
// governance (change_threshold action with only timelock changed).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { completeTypedGovernance } from "@/lib/hooks/completeTypedGovernance";
import {
  IntentType,
  ProposalStatus,
  type IntentAccount,
} from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";

interface UpdateArgs {
  walletName: string;
  intentIndex: number;
  newTimelockSeconds: number;
  templateFile: string;
}

/// Maps on-chain chainKind to the canonical template file path.
export function templateFileForChainKind(chainKind: number): string {
  switch (chainKind) {
    case 0:
      return "examples/intents/solana_transfer.json";
    case 1:
      return "examples/intents/evm_transfer_sepolia.json";
    case 2:
      return "examples/intents/btc_transfer.json";
    case 3:
      return "examples/intents/zcash_transfer.json";
    case 4:
      return "examples/intents/erc20_transfer_sepolia.json";
    case 5:
      return "examples/intents/hyperliquid_transfer.json";
    default:
      throw new Error(`No editable template for chainKind ${chainKind}`);
  }
}

export function useUpdateTimelock() {
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      walletName,
      intentIndex,
      newTimelockSeconds,
      templateFile,
    }: UpdateArgs) => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!Number.isFinite(newTimelockSeconds) || newTimelockSeconds < 0) {
        throw new Error("Timelock must be 0 or positive seconds");
      }
      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData) throw new Error("Couldn't load wallet");

      const intents = await listIntents(
        connection,
        walletData.pda,
        walletData.account.intentIndex,
      );
      const target = intents.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.intentIndex === intentIndex,
      );
      const intent = target?.account as IntentAccount | undefined;
      if (!intent) {
        throw new Error(`No intent at index ${intentIndex}`);
      }
      if (intent.timelockSeconds === newTimelockSeconds) {
        return { kind: "noop" } as const;
      }
      const governanceIntent = intents.find(
        (it) => it.account !== null && it.account.intentIndex === 2,
      )?.account as IntentAccount | undefined;
      const voteIntent = governanceIntent ?? intent;
      const signerPk = wallet.pickSigner(voteIntent.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets can approve rule changes for this wallet.",
        );
      }
      if (!voteIntent.proposers.includes(signerPk.toBase58())) {
        throw new Error(
          "Your connected wallet can approve this wallet, but it cannot propose rule changes.",
        );
      }

      const proposals = await listProposalsForWallet(
        connection,
        walletData.pda,
        walletData.account,
      );
      const stuck = proposals.filter(
        (p) =>
          p.intentIndex === intent.intentIndex &&
          p.account.status === ProposalStatus.Approved,
      );
      for (const p of stuck) {
        try {
          await backendApi.executeProposal(walletName, p.pda.toBase58(), {});
        } catch (err) {
          console.warn(
            `[update-timelock] couldn't drain stuck proposal ${p.pda.toBase58()}`,
            err,
          );
        }
      }

      const result = await completeTypedGovernance({
        connection,
        walletName,
        walletId: walletData.pda.toBase58(),
        voteIntentIndex: voteIntent.intentIndex,
        voteApprovers: voteIntent.approvers,
        voteApprovalThreshold: voteIntent.approvalThreshold,
        targetIntentIndex: intent.intentIndex,
        proposers: intent.proposers,
        approvers: intent.approvers,
        approvalThreshold: intent.approvalThreshold,
        cancellationThreshold: intent.cancellationThreshold,
        timelockSeconds: newTimelockSeconds,
        templateFile,
        kind: "change_threshold",
        proposerPk: signerPk,
        signTypedDescriptor,
        pickApprover: (approvers) => wallet.pickSigner(approvers),
      });
      return result.kind === "executed"
        ? ({ kind: "updated", proposal: result.proposal } as const)
        : ({ kind: "awaiting_approvals", proposal: result.proposal } as const);
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet", vars.walletName],
      });
    },
  });
}
