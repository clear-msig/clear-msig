"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import {
  clearSignProfileForSigner,
  prepareClearSignAction,
  randomActionLabel,
  type ClearSignEnvelope,
  type ProtectionPayload,
} from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import {
  buildPersistentPersonalPolicyTargets,
  currentWalletPolicyCommitment,
  type PersistentPolicyTarget,
} from "@/lib/policies/persistentWalletPolicy";

export interface PersistWalletPolicyResult {
  updated: number;
  skipped: number;
  waiting: number;
}

export function usePersistPersonalWalletPolicy() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();

  const persistOne = useCallback(
    async (input: {
      walletName: string;
      walletId: string;
      intentIndex: number;
      intentApprovers: string[];
      approvalThreshold: number;
      proposerPk: NonNullable<ReturnType<typeof wallet.pickSigner>>;
      currentCommitment: string;
      target: PersistentPolicyTarget;
    }): Promise<"updated" | "waiting"> => {
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const envelope: ClearSignEnvelope<ProtectionPayload> = {
        version: 3,
        kind: "set_protection",
        network: "Solana devnet",
        walletName: input.walletName,
        walletId: input.walletId,
        actionId: randomActionLabel("set-protection"),
        nonce: randomActionLabel("nonce"),
        expiresAt,
        policyCommitment: input.currentCommitment,
        payload: {
          summary: input.target.summary,
          policyCommitment: input.target.policyCommitmentHex,
          chainKind: input.target.chainKind,
        },
      };
      const summary = await prepareClearSignAction(envelope, {
        fallback: false,
        deviceProfile: clearSignProfileForSigner(wallet, input.proposerPk),
      });
      const dry = await backendApi.prepare.createTypedProposal(input.walletName, {
        intent_index: input.intentIndex,
        action_kind: summary.actionKindCode,
        policy_commitment: envelope.policyCommitment,
        payload_hash: summary.payloadHash,
        envelope_hash: summary.envelopeHash,
        action_id: envelope.actionId,
        nonce: envelope.nonce,
        policyBytesHex: input.target.policyBytesHex,
        signable_text: summary.signableText,
        expiry: formatUnixSigningExpiry(envelope.expiresAt),
        actor_pubkey: input.proposerPk.toBase58(),
      });
      const signed = await signTypedDescriptor(dry, {
        preferSigner: input.proposerPk,
        expectedTyped: {
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          signableText: summary.signableText,
        },
      });
      const submitted = await backendApi.submit.createTypedProposal(
        input.walletName,
        {
          ...signed,
          expiry: dry.expiry,
          intent_index: dry.intent_index,
          action_kind: dry.action_kind,
          policy_commitment: dry.policy_commitment_hex,
          payload_hash: dry.payload_hash_hex,
          envelope_hash: dry.envelope_hash_hex,
          action_id: dry.action_id,
          nonce: dry.nonce,
          policyBytesHex: input.target.policyBytesHex,
        },
      );
      const proposal = submitted.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend did not return a policy proposal address.");
      }

      const approverPk = wallet.pickSigner(input.intentApprovers);
      const decision = await approveIfNeeded(connection, proposal, {
        approvers: input.intentApprovers,
        approverPubkey: approverPk?.toBase58() ?? null,
        approvalThreshold: input.approvalThreshold,
      });
      if (decision.needsApproveSignature) {
        if (!approverPk) return "waiting";
        const approveDry = await backendApi.prepare.approveTypedProposal(
          input.walletName,
          proposal,
          { actor_pubkey: approverPk.toBase58() },
        );
        const approveSigned = await signTypedDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveTypedProposal(input.walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      const ready = await waitForProposalApproval(connection, proposal);
      if (!ready) return "waiting";
      await backendApi.executeTypedWalletPolicyUpdate(input.walletName, proposal, {
        policyBytesHex: input.target.policyBytesHex,
        chainKind: input.target.chainKind,
      });
      return "updated";
    },
    [connection, signTypedDescriptor, wallet],
  );

  return useCallback(
    async (walletName: string): Promise<PersistWalletPolicyResult> => {
      const walletData = await fetchWalletByName(connection, walletName);
      if (!walletData) {
        throw new Error("Wallet is still loading. Try again.");
      }
      const intents = await listIntents(
        connection,
        walletData.pda,
        walletData.account.intentIndex,
      );
      const intent = intents.find(
        (row) =>
          row.account?.approved &&
          row.account.proposers.some((proposer) => wallet.pickSigner([proposer])),
      );
      if (!intent?.account) {
        throw new Error(
          "Turn on sending first, then save limits on chain.",
        );
      }
      const proposerPk = wallet.pickSigner(intent.account.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets can propose protection updates for this wallet.",
        );
      }

      let updated = 0;
      let skipped = 0;
      let waiting = 0;
      for (const target of await buildPersistentPersonalPolicyTargets(walletName)) {
        const currentCommitment = await currentWalletPolicyCommitment(
          connection,
          walletData.pda,
          target.chainKind,
        );
        if (currentCommitment === target.policyCommitmentHex) {
          skipped += 1;
          continue;
        }
        const outcome = await persistOne({
          walletName,
          walletId: walletData.pda.toBase58(),
          intentIndex: intent.account.intentIndex,
          intentApprovers: intent.account.approvers,
          approvalThreshold: intent.account.approvalThreshold,
          proposerPk,
          currentCommitment,
          target,
        });
        if (outcome === "updated") updated += 1;
        if (outcome === "waiting") waiting += 1;
      }
      return { updated, skipped, waiting };
    },
    [connection, wallet, persistOne],
  );
}
