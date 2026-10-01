"use client";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";

import {
  reviewedCreationProposalAddress,
  inlineApprovalOptions,
  assertSubmittedCreation,
  savedProposalError,
} from "@/lib/clearsign/inlineApproval";

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
  prepareClearSignV4Action,
  randomActionLabel,
  type ClearSignIntentInput,
  type ProtectionPayload,
  type AssetProtectionPayload,
} from "@/lib/clearsign";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import {
  buildPersistentPersonalPolicyTargets,
  currentWalletPolicyCommitment,
  currentAssetPolicyCommitment,
  type PersistentPolicyTarget,
} from "@/lib/policies/persistentWalletPolicy";

export interface PersistWalletPolicyResult {
  updated: number;
  skipped: number;
  waiting: number;
}

export function usePersistPersonalWalletPolicy() {
  const wallet = useWallet();
  const requestIdentity = useRequestIdentity();
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
      requestIdentity.assertCurrent();
      const recovery = requestRecovery.begin({
        walletName: input.walletName,
        endpoint: connection.rpcEndpoint,
        accountKey: requestIdentity.accountKey,
        label: "Protection policy change",
        identity: [
          input.walletId,
          input.intentIndex,
          input.target.policyCommitmentHex,
          input.target.chainKind,
          input.target.scope,
          input.target.assetId,
        ],
      });
      try {
        const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
        const isAsset = input.target.scope === "asset";
        const envelope: ClearSignIntentInput<
          ProtectionPayload | AssetProtectionPayload
        > = {
          kind: isAsset ? "set_asset_protection" : "set_protection",
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
            ...(isAsset
              ? {
                  scopeKind: input.target.scopeKind!,
                  decimals: input.target.decimals,
                  assetId: input.target.assetId!,
                  displayAsset: input.target.ticker,
                }
              : {}),
          },
        };
        const summary = await prepareClearSignV4Action(envelope, {
          intentIndex: input.intentIndex,
          actorPubkey: input.proposerPk.toBase58(),
          policyBytesHex: input.target.policyBytesHex,
          deviceProfile: clearSignProfileForSigner(wallet, input.proposerPk),
        });
        requestIdentity.assertCurrent();
        const dry = await backendApi.prepare.createTypedProposal(
          input.walletName,
          {
            intent_index: input.intentIndex,
            action_kind: summary.actionKindCode,
            policy_commitment: summary.policyCommitment,
            payload_hash: summary.payloadHash,
            envelope_hash: summary.envelopeHash,
            action_id: envelope.actionId,
            nonce: envelope.nonce,
            policyBytesHex: input.target.policyBytesHex,
            signable_text: summary.signableText,
            canonical_intent_hex: summary.canonicalIntentHex,
            expiry: formatUnixSigningExpiry(envelope.expiresAt),
            actor_pubkey: input.proposerPk.toBase58(),
          },
        );
        requestIdentity.assertCurrent();
        const signed = await signTypedDescriptor(dry, {
          preferSigner: input.proposerPk,
          expectedTyped: {
            envelopeHash: summary.envelopeHash,
            payloadHash: summary.payloadHash,
            signableText: summary.signableText,
          },
        });
        requestIdentity.assertCurrent();
        recovery.submitting(reviewedCreationProposalAddress(dry, summary));
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
            canonical_intent_hex: dry.canonical_intent_hex,
          },
        );
        const proposal = submitted.proposal;
        assertSubmittedCreation(dry, summary, proposal);
        recovery.accepted(dry.proposal_pubkey);
        try {
          if (typeof proposal !== "string" || proposal.length === 0) {
            throw new Error(
              "Backend did not return a policy proposal address.",
            );
          }

          const approverPk = wallet.pickSigner(input.intentApprovers);
          const decision = await approveIfNeeded(connection, proposal, {
            approvers: input.intentApprovers,
            approverPubkey: approverPk?.toBase58() ?? null,
            approvalThreshold: input.approvalThreshold,
          });
          if (decision.needsApproveSignature) {
            if (!approverPk) return "waiting";
            requestIdentity.assertCurrent();
            const approveDry = await backendApi.prepare.approveTypedProposal(
              input.walletName,
              proposal,
              { actor_pubkey: approverPk.toBase58() },
            );
            requestIdentity.assertCurrent();
            const approveSigned = await signTypedDescriptor(
              approveDry,
              inlineApprovalOptions(
                dry,
                approveDry,
                summary,
                proposal,
                approverPk,
              ),
            );
            requestIdentity.assertCurrent();
            await backendApi.submit.approveTypedProposal(
              input.walletName,
              proposal,
              {
                ...approveSigned,
                expiry: approveDry.expiry,
              },
            );
          }

          const ready = await waitForProposalApproval(connection, proposal);
          requestIdentity.assertCurrent();
          if (!ready) return "waiting";
          if (isAsset) {
            requestIdentity.assertCurrent();
            const executed = await backendApi.executeTypedAssetPolicyUpdate(
              input.walletName,
              proposal,
              {
                policyBytesHex: input.target.policyBytesHex,
                chainKind: input.target.chainKind,
                scopeKind: input.target.scopeKind!,
                decimals: input.target.decimals,
                assetId: input.target.assetId!,
                displayAsset: input.target.ticker,
              },
            );
            if (typeof executed.txid !== "string" || !executed.txid.trim())
              throw new Error(
                "Execution returned no transaction ID; protection activation is not confirmed.",
              );
          } else {
            requestIdentity.assertCurrent();
            const executed = await backendApi.executeTypedWalletPolicyUpdate(
              input.walletName,
              proposal,
              {
                policyBytesHex: input.target.policyBytesHex,
                chainKind: input.target.chainKind,
              },
            );
            if (typeof executed.txid !== "string" || !executed.txid.trim())
              throw new Error(
                "Execution returned no transaction ID; protection activation is not confirmed.",
              );
          }
          requestIdentity.assertCurrent();
          recovery.complete();
          return "updated";
        } catch (cause) {
          throw savedProposalError(dry.proposal_pubkey, cause);
        }
      } finally {
        recovery.finish();
      }
    },
    [connection, signTypedDescriptor, wallet, requestIdentity],
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
          row.account.proposers.some((proposer) =>
            wallet.pickSigner([proposer]),
          ),
      );
      if (!intent?.account) {
        throw new Error("Turn on sending first, then save limits on chain.");
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
      for (const target of await buildPersistentPersonalPolicyTargets(
        walletName,
      )) {
        const currentCommitment =
          target.scope === "asset"
            ? await currentAssetPolicyCommitment(
                connection,
                walletData.pda,
                target.assetId!,
              )
            : await currentWalletPolicyCommitment(
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
