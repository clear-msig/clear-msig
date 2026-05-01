"use client";

// Change a member's role on a shared wallet. Mirror of
// useRemoveMember: propose UpdateIntent → approve → execute, with a
// recovery sweep for stale Approved-but-not-Executed proposals so
// the program's IntentHasActiveProposals check doesn't reject.
//
// Role transitions on chain:
//   full     → in proposers + approvers
//   approver → in approvers only
//   watcher  → in neither (local-only watcher store)
//
// Watcher target → run the chain mutation only if the friend is
// currently on chain (drop them from approvers/proposers), then add
// them to the local watchers store. Watcher → full / approver runs
// the chain mutation to add them, then removes the local watcher
// record.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { listProposalsForWallet } from "@/lib/chain/proposals";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  fromHex,
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
  /// Display name to write to the watchers store if the new role is
  /// "watcher". Falls back to a shortened address when missing.
  friendName?: string;
  newRole: Role;
}

export function useUpdateMemberRole() {
  const { connection } = useConnection();
  const { signBytes } = useSignWithWallet();
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
      const me = wallet.publicKey.toBase58();

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

      const wasApprover = intent.approvers.includes(friendAddress);
      const wasProposer = intent.proposers.includes(friendAddress);
      const isOnChain = wasApprover || wasProposer;

      // Compute target proposer/approver lists from the new role.
      let newApprovers = [...intent.approvers];
      let newProposers = [...intent.proposers];
      if (newRole === "watcher") {
        // Drop from both — chain layer no longer tracks this person.
        newApprovers = newApprovers.filter((a) => a !== friendAddress);
        newProposers = newProposers.filter((p) => p !== friendAddress);
      } else if (newRole === "approver") {
        if (!wasApprover) newApprovers.push(friendAddress);
        newProposers = newProposers.filter((p) => p !== friendAddress);
      } else if (newRole === "full") {
        if (!wasApprover) newApprovers.push(friendAddress);
        if (!wasProposer) newProposers.push(friendAddress);
      }

      // Threshold safety — same guard as remove. Refuse if dropping
      // approvers leaves the threshold unsatisfiable.
      if (intent.approvalThreshold > newApprovers.length) {
        throw new Error(
          `Changing this role would leave fewer approvers (${newApprovers.length}) ` +
            `than the wallet's required threshold (${intent.approvalThreshold}). ` +
            `Lower the threshold first, or pick a different role.`,
        );
      }

      // Local-only path: watcher → watcher (no-op chain) is rare but
      // possible if someone re-saves. Either way, ensure the watcher
      // record is in sync.
      const localWatchers = listWatchers(walletName);
      const wasWatcher = localWatchers.some((w) => w.address === friendAddress);

      // No on-chain change required if (a) target role is watcher and
      // they weren't on chain, or (b) chain lists already match the
      // desired role. Just reconcile the local watcher record.
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
            name: friendName ?? `${friendAddress.slice(0, 4)}…${friendAddress.slice(-4)}`,
          });
        } else if (newRole !== "watcher" && wasWatcher) {
          removeWatcher(walletName, friendAddress);
        }
        return { kind: "local-only" } as const;
      }

      // Sweep stale Approved proposals on the target intent so the
      // program's IntentHasActiveProposals check doesn't reject.
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

      // Encrypt the new policy fields for forward-compat (Encrypt
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

      // 1. Prepare UpdateIntent.
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

      // 2. Sign propose — first wallet popup.
      const signed = await signBytes(fromHex(dry.message_hex));
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

      // 3. Approve — only when propose hasn't already auto-approved
      //    on chain (program flips proposer's bit when proposer ∈
      //    approvers; with threshold=1 the proposal lands Approved).
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          walletName,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signBytes(fromHex(approveDry.message_hex));
        await backendApi.submit.approveProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      // 4. Execute — sponsored, no signature.
      await backendApi.executeProposal(walletName, proposal, {});

      // 5. Reconcile the local watcher record.
      if (newRole === "watcher") {
        addWatcher({
          walletName,
          address: friendAddress,
          name: friendName ?? `${friendAddress.slice(0, 4)}…${friendAddress.slice(-4)}`,
        });
      } else if (wasWatcher) {
        removeWatcher(walletName, friendAddress);
      }

      // Quiet the linter — `isOnChain` exists for symmetry with the
      // remove hook's call sites; consumers can branch on the return.
      void isOnChain;

      return { kind: "updated" } as const;
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet", vars.walletName],
      });
    },
  });
}
