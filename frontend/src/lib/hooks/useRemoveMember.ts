"use client";

// Remove a friend from a shared wallet. Mirrors the add-friend mutation
// in `members/add/page.tsx`: propose UpdateIntent that drops the
// friend from both proposers and approvers, then approve (the actor's
// signature flips the bitmap), then execute (sponsored, no signature).
//
// Watchers - friends in the local watchers store but not in any
// on-chain list - skip the chain entirely. We just remove the local
// record and return.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { completeGovernedProposal } from "@/lib/hooks/completeGovernedProposal";
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
  /// "watcher" → local-only; anything else → on-chain UpdateIntent
  /// dropping the friend from both proposers + approvers.
  role: "full" | "approver" | "watcher" | "unknown";
}

export function useRemoveMember() {
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ walletName, friendAddress, role }: RemoveArgs) => {
      // Watchers live only in localStorage - no chain mutation needed.
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
      const signerPk = governanceIntent
        ? wallet.pickSigner(governanceIntent.approvers)
        : wallet.pickSigner(intent.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets can approve member changes for this wallet.",
        );
      }
      const me = signerPk.toBase58();
      if (governanceIntent && !governanceIntent.proposers.includes(me)) {
        throw new Error(
          "Your connected wallet can approve this wallet, but it cannot propose member changes.",
        );
      }

      // Don't try to drop someone who isn't actually a member.
      const wasApprover = intent.approvers.includes(friendAddress);
      const wasProposer = intent.proposers.includes(friendAddress);
      if (!wasApprover && !wasProposer) {
        // Already gone from the chain side; just clear any local
        // watcher record and call it done.
        removeWatcher(walletName, friendAddress);
        return { kind: "noop" } as const;
      }

      const newApprovers = intent.approvers.filter(
        (a) => a !== friendAddress,
      );
      const newProposers = intent.proposers.filter(
        (p) => p !== friendAddress,
      );

      // Threshold safety: if dropping this approver would leave the
      // threshold higher than the remaining count, the program rejects
      // with InvalidApprovalThreshold. Surface a clean error before
      // we burn the user's signature popups.
      if (intent.approvalThreshold > newApprovers.length) {
        throw new Error(
          `Removing this friend would leave fewer approvers (${newApprovers.length}) ` +
            `than the wallet's required threshold (${intent.approvalThreshold}). ` +
            `Lower the rule's threshold first, or remove someone else.`,
        );
      }

      // Sweep stale Approved-but-not-Executed proposals on the
      // target intent so the program's IntentHasActiveProposals
      // check doesn't reject the UpdateIntent.
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

      // Encrypt the new policy lists for forward-compat (Encrypt
      // alpha 1 will pin these on chain via #[encrypt_fn]).
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(newProposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(newApprovers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([intent.approvalThreshold]), fheType: "euint8" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      // 1. Prepare UpdateIntent with the slimmed-down lists.
      const dry = await backendApi.prepare.updateIntent(walletName, {
        index: intent.intentIndex,
        file: TEMPLATE_FILE,
        proposers: newProposers,
        approvers: newApprovers,
        threshold: intent.approvalThreshold,
        cancellation_threshold: intent.cancellationThreshold,
        timelock: intent.timelockSeconds,
        policy_ciphertexts,
      });

      // 2. Sign - first wallet popup.
      const signed = await signDescriptor(dry, { preferSigner: signerPk });

      // 3. Submit propose.
      const submitted = await backendApi.submit.updateIntent(walletName, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        index: intent.intentIndex,
        file: TEMPLATE_FILE,
      });

      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error(
          "Backend didn't return a proposal address from the propose step",
        );
      }

      // 4. Approve - only if propose didn't already auto-approve
      //    (the program flips the proposer's bit when proposer is
      //    in approvers; with threshold=1 this lands the proposal
      //    Approved directly).
      const completion = await completeGovernedProposal({
        connection,
        walletName,
        proposal,
        approvers: governanceIntent?.approvers ?? intent.approvers,
        approverPubkey: me,
        approvalThreshold:
          governanceIntent?.approvalThreshold ?? intent.approvalThreshold,
        signerPk,
        signDescriptor,
      });
      if (completion === "awaiting_approvals") {
        return { kind: "awaiting_approvals", proposal } as const;
      }

      // Clean up the local watcher record too in case the friend was
      // pinned there as well.
      removeWatcher(walletName, friendAddress);

      return { kind: "removed", proposal } as const;
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet", vars.walletName],
      });
    },
  });
}
