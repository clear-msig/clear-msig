"use client";

// Update an existing intent's timelock_seconds. Mirrors
// useUpdateMemberRole - propose UpdateIntent → approve → execute,
// with a stale-proposal sweep so the program's
// IntentHasActiveProposals check doesn't reject.
//
// Only the timelock field changes. proposers / approvers /
// thresholds round-trip unchanged so this can't accidentally
// loosen the wallet's approval policy. The CLI still re-validates
// every field on chain via UpdateIntent so a malicious frontend
// can't swap the others out from under the user.

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
  /// Index of the intent to update - see IntentAccount.intentIndex.
  intentIndex: number;
  /// New timelock value in seconds. 0 = ship immediately on
  /// approval; > 0 = additional wait before execute.
  newTimelockSeconds: number;
  /// Path to the intent template file. Same shape the CLI used
  /// when the intent was created (looked up from the on-chain
  /// chainKind by the caller - see useUpdateTimelock callers in
  /// the rules page for the mapping).
  templateFile: string;
}

/// Maps on-chain chainKind to the canonical template file path.
/// UpdateIntent re-runs the encoder for the same template, so
/// passing the wrong file would change params/accounts and break
/// the wallet's existing intent. Keep this in sync with the setup
/// pages.
export function templateFileForChainKind(chainKind: number): string {
  switch (chainKind) {
    case 0:
      return "examples/intents/solana_transfer.json";
    case 1:
      return "examples/intents/evm_transfer_sepolia.json";
    case 4:
      return "examples/intents/erc20_transfer_sepolia.json";
    case 5:
      return "examples/intents/hyperliquid_transfer.json";
    default:
      // Bitcoin (2) and Zcash (3) intents aren't editable from
      // the UI today; the rules page hides the timelock-edit
      // affordance for them.
      throw new Error(`No editable template for chainKind ${chainKind}`);
  }
}

export function useUpdateTimelock() {
  const { connection } = useConnection();
  const { signDescriptor } = useSignWithWallet();
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

      // Drain stuck Approved proposals on this intent so the
      // program's IntentHasActiveProposals check doesn't reject
      // the propose step.
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

      // Re-encrypt the policy fields. The proposer/approver/threshold
      // values stay the same; only the timelock byte changes. We
      // round-trip everything through encryptPolicyBatch so the
      // ciphertext IDs come out fresh - Encrypt's spec says repeat
      // calls produce distinct identifiers, and the CLI keys the
      // policy_ciphertexts array off them.
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        {
          plaintext: enc.encode(JSON.stringify(intent.proposers)),
          fheType: "ebytes",
        },
        {
          plaintext: enc.encode(JSON.stringify(intent.approvers)),
          fheType: "ebytes",
        },
        {
          plaintext: new Uint8Array([intent.approvalThreshold]),
          fheType: "euint8",
        },
        {
          plaintext: new Uint8Array([newTimelockSeconds & 0xff]),
          fheType: "euint32",
        },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      const dry = await backendApi.prepare.updateIntent(walletName, {
        index: intent.intentIndex,
        file: templateFile,
        proposers: intent.proposers,
        approvers: intent.approvers,
        threshold: intent.approvalThreshold,
        cancellation_threshold: intent.cancellationThreshold,
        timelock: newTimelockSeconds,
        policy_ciphertexts,
      });

      const signed = await signDescriptor(dry);
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
          "Backend didn't return a proposal address from the propose step",
        );
      }

      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          walletName,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signDescriptor(approveDry);
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
