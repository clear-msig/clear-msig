"use client";

// Change a member's role on a shared wallet via typed ClearSign governance.

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
import { addWatcher, removeWatcher, type Role } from "@/lib/retail/roles";
import { listWatchers } from "@/lib/retail/roles";

const TEMPLATE_FILE = "examples/intents/solana_transfer.json";

interface UpdateArgs {
  walletName: string;
  friendAddress: string;
  friendName?: string;
  newRole: Role;
}

export function useUpdateMemberRole() {
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      walletName,
      friendAddress,
      friendName,
      newRole,
    }: UpdateArgs) => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
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
      const isOnChain = wasApprover || wasProposer;

      let newApprovers = [...intent.approvers];
      let newProposers = [...intent.proposers];
      if (newRole === "watcher") {
        newApprovers = newApprovers.filter((a) => a !== friendAddress);
        newProposers = newProposers.filter((p) => p !== friendAddress);
      } else if (newRole === "approver") {
        if (!wasApprover) newApprovers.push(friendAddress);
        newProposers = newProposers.filter((p) => p !== friendAddress);
      } else if (newRole === "full") {
        if (!wasApprover) newApprovers.push(friendAddress);
        if (!wasProposer) newProposers.push(friendAddress);
      }

      if (intent.approvalThreshold > newApprovers.length) {
        throw new Error(
          `Changing this role would leave fewer approvers (${newApprovers.length}) ` +
            `than the wallet's required threshold (${intent.approvalThreshold}). ` +
            `Lower the threshold first, or pick a different role.`,
        );
      }

      const localWatchers = listWatchers(walletName);
      const wasWatcher = localWatchers.some((w) => w.address === friendAddress);

      const samesAsChain =
        newApprovers.length === intent.approvers.length &&
        newApprovers.every((a, i) => a === intent.approvers[i]) &&
        newProposers.length === intent.proposers.length &&
        newProposers.every((p, i) => p === intent.proposers[i]);

      if (samesAsChain) {
        if (newRole === "watcher" && !wasWatcher) {
          addWatcher({
            walletName,
            address: friendAddress,
            name:
              friendName ??
              `${friendAddress.slice(0, 4)}…${friendAddress.slice(-4)}`,
          });
        } else if (newRole !== "watcher" && wasWatcher) {
          removeWatcher(walletName, friendAddress);
        }
        return { kind: "local-only" } as const;
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
            `[update-role] couldn't drain stuck proposal ${p.pda.toBase58()}`,
            err,
          );
        }
      }

      const kind =
        !isOnChain && (newRole === "full" || newRole === "approver")
          ? "add_member"
          : newRole === "watcher"
            ? "remove_member"
            : "add_member";

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
        kind,
        member: friendAddress,
        role: newRole === "full" ? "full" : "approver",
        proposerPk: signerPk,
        signTypedDescriptor,
        pickApprover: (approvers) => wallet.pickSigner(approvers),
        deviceProfile: clearSignProfileForSigner(wallet, signerPk),
      });
      if (result.kind === "awaiting_approvals") {
        return { kind: "awaiting_approvals", proposal: result.proposal } as const;
      }

      if (newRole === "watcher") {
        addWatcher({
          walletName,
          address: friendAddress,
          name:
            friendName ??
            `${friendAddress.slice(0, 4)}…${friendAddress.slice(-4)}`,
        });
      } else if (wasWatcher) {
        removeWatcher(walletName, friendAddress);
      }

      return { kind: "updated", proposal: result.proposal } as const;
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet", vars.walletName],
      });
    },
  });
}
