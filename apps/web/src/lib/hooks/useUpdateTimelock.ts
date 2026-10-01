"use client";
import { savedProposalError } from "@/lib/clearsign/inlineApproval";

// Update an existing intent's timelock_seconds via typed ClearSign
// governance (change_threshold action with only timelock changed).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { completeTypedGovernance } from "@/lib/hooks/completeTypedGovernance";
import { clearSignProfileForSigner } from "@/lib/clearsign";
import { IntentType, ProposalStatus, type IntentAccount } from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
export { templateFileForChainKind } from "@/lib/intents/generatedRegistry";

interface UpdateArgs {
  walletName: string;
  intentIndex: number;
  newTimelockSeconds: number;
  templateFile: string;
}

export function useUpdateTimelock() {
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const requestIdentity = useRequestIdentity();
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
          (p.account.status === ProposalStatus.Approved ||
            p.account.status === ProposalStatus.Active),
      );
      if (stuck.length)
        throw savedProposalError(
          stuck[0].pda.toBase58(),
          new Error(
            "This existing request blocks the authority change. Review and finish or cancel it explicitly; no existing request was executed automatically.",
          ),
        );

      const result = await completeTypedGovernance({
        requestIdentity: requestIdentity.capture(),
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
        deviceProfile: clearSignProfileForSigner(wallet, signerPk),
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
