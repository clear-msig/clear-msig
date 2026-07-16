"use client";

// Remove a friend from a shared wallet via typed ClearSign governance.
// Watchers stay local-only.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { completeTypedGovernance } from "@/lib/hooks/completeTypedGovernance";
import { clearSignProfileForSigner } from "@/lib/clearsign";
import {
  IntentType,
  ProposalStatus,
  type IntentAccount,
} from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { removeWatcher } from "@/lib/retail/roles";

const TEMPLATE_FILE = "examples/intents/solana_transfer.json";

interface RemoveArgs {
  walletName: string;
  friendAddress: string;
  /// "watcher" → local-only; anything else → on-chain typed governance
  role: "full" | "approver" | "watcher" | "unknown";
}

export function useRemoveMember() {
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletName, friendAddress, role }: RemoveArgs) => {
      if (role === "watcher") {
        removeWatcher(walletName, friendAddress);
        return { kind: "watcher" } as const;
      }

      if (!wallet.publicKey) {
        throw new Error("Connect your wallet first");
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
          it.account !== null && it.account.intentType === IntentType.Custom,
      );
      const intent = target?.account as IntentAccount | undefined;
      if (!intent) throw new Error("No spending rule on this wallet");
      const governanceIntent = intents.find(
        (it) => it.account !== null && it.account.intentIndex === 2,
      )?.account as IntentAccount | undefined;
      const voteIntent = governanceIntent ?? intent;
      const signerPk = wallet.pickSigner(voteIntent.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets can approve member changes for this wallet.",
        );
      }
      if (!voteIntent.proposers.includes(signerPk.toBase58())) {
        throw new Error(
          "Your connected wallet can approve this wallet, but it cannot propose member changes.",
        );
      }

      const wasApprover = intent.approvers.includes(friendAddress);
      const wasProposer = intent.proposers.includes(friendAddress);
      if (!wasApprover && !wasProposer) {
        removeWatcher(walletName, friendAddress);
        return { kind: "noop" } as const;
      }

      const newApprovers = intent.approvers.filter((a) => a !== friendAddress);
      const newProposers = intent.proposers.filter((p) => p !== friendAddress);
      if (intent.approvalThreshold > newApprovers.length) {
        throw new Error(
          `Removing this friend would leave fewer approvers (${newApprovers.length}) ` +
            `than the wallet's required threshold (${intent.approvalThreshold}). ` +
            `Lower the rule's threshold first, or remove someone else.`,
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
            `[remove-member] couldn't drain stuck proposal ${p.pda.toBase58()}`,
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
        proposers: newProposers,
        approvers: newApprovers,
        approvalThreshold: intent.approvalThreshold,
        cancellationThreshold: intent.cancellationThreshold,
        timelockSeconds: intent.timelockSeconds,
        templateFile: TEMPLATE_FILE,
        kind: "remove_member",
        member: friendAddress,
        role: wasProposer ? "full" : "approver",
        proposerPk: signerPk,
        signTypedDescriptor,
        pickApprover: (approvers) => wallet.pickSigner(approvers),
        deviceProfile: clearSignProfileForSigner(wallet, signerPk),
      });
      removeWatcher(walletName, friendAddress);
      return result.kind === "executed"
        ? ({ kind: "removed", proposal: result.proposal } as const)
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
