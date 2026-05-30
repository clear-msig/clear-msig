"use client";

// Update an intent's approval threshold without changing the member
// lists or timelock. Mirrors the timelock / roster editors: propose
// UpdateIntent → approve → execute, with the same stale-proposal sweep.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  IntentType,
  ProposalStatus,
  type IntentAccount,
} from "@/lib/msig";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";

interface UpdateArgs {
  walletName: string;
  intentIndex: number;
  newThreshold: number;
  templateFile: string;
}

export function useUpdateApprovalThreshold() {
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      walletName,
      intentIndex,
      newThreshold,
      templateFile,
    }: UpdateArgs) => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!Number.isFinite(newThreshold) || newThreshold < 1) {
        throw new Error("Threshold must be at least 1");
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
      if (intent.approvalThreshold === newThreshold) {
        return { kind: "noop" } as const;
      }
      if (newThreshold > intent.approvers.length) {
        throw new Error(
          `Threshold ${newThreshold} exceeds the number of approvers (${intent.approvers.length})`,
        );
      }
      const governanceIntent = intents.find(
        (it) => it.account !== null && it.account.intentIndex === 2,
      )?.account as IntentAccount | undefined;
      const signerPk = governanceIntent
        ? wallet.pickSigner(governanceIntent.approvers)
        : wallet.pickSigner(intent.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets can approve rule changes for this wallet.",
        );
      }
      const me = signerPk.toBase58();
      if (governanceIntent && !governanceIntent.proposers.includes(me)) {
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
            `[update-threshold] couldn't drain stuck proposal ${p.pda.toBase58()}`,
            err,
          );
        }
      }

      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(intent.proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(intent.approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([newThreshold]), fheType: "euint8" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      const dry = await backendApi.prepare.updateIntent(walletName, {
        index: intent.intentIndex,
        file: templateFile,
        proposers: intent.proposers,
        approvers: intent.approvers,
        threshold: newThreshold,
        cancellation_threshold: intent.cancellationThreshold,
        timelock: intent.timelockSeconds,
        policy_ciphertexts,
      });

      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      const submitted = await backendApi.submit.updateIntent(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        index: intent.intentIndex,
        file: templateFile,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          "Backend didn't return a proposal address from the threshold update",
        );
      }

      const decision = await approveIfNeeded(connection, proposal, {
        approvers: governanceIntent?.approvers ?? intent.approvers,
        approverPubkey: me,
      });
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          walletName,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      await backendApi.executeProposal(walletName, proposal, {});
      return { kind: "updated", proposal } as const;
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet", vars.walletName],
      });
    },
  });
}
