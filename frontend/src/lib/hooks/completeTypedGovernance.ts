// Shared path for typed ClearSign membership / threshold / timelock updates.
// Replaces legacy UpdateIntent + signDescriptor with typed proposals that
// bind the final governance state on-chain (execute_typed_intent_governance).

import type { Connection } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import {
  prepareClearSignAction,
  randomActionLabel,
  type ClearSignActionKind,
  type ClearSignEnvelope,
  type MemberPayload,
  type ThresholdPayload,
} from "@/lib/clearsign";
import type { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import {
  encodeTypedGovernancePayload,
  typedGovernanceCommitmentHex,
} from "@/lib/hooks/typedGovernancePayload";

type SignTyped = ReturnType<typeof useSignWithWallet>["signTypedDescriptor"];

export type TypedGovernanceKind =
  | "add_member"
  | "remove_member"
  | "change_threshold";

export interface TypedGovernanceInput {
  connection: Connection;
  walletName: string;
  walletId: string;
  /** Intent used for voting (typically UpdateIntent meta index 2). */
  voteIntentIndex: number;
  voteApprovers: string[];
  voteApprovalThreshold: number;
  /** Custom intent being rewritten. */
  targetIntentIndex: number;
  proposers: string[];
  approvers: string[];
  approvalThreshold: number;
  cancellationThreshold: number;
  timelockSeconds: number;
  /** Intent template used to rebuild the on-chain body. */
  templateFile: string;
  kind: TypedGovernanceKind;
  /** Required for add/remove; ignored for change_threshold. */
  member?: string;
  role?: string;
  proposerPk: PublicKey;
  signTypedDescriptor: SignTyped;
  pickApprover: (approvers: string[]) => PublicKey | null;
}

export type TypedGovernanceResult =
  | { kind: "executed"; proposal: string }
  | { kind: "awaiting_approvals"; proposal: string };

export async function completeTypedGovernance(
  input: TypedGovernanceInput,
): Promise<TypedGovernanceResult> {
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;

  // Build and commit the exact replacement body before anyone signs. Keeping
  // it in the typed proposal makes delayed multi-approver execution resumable
  // without trusting browser-local state or a backend database.
  const bodyDry = await backendApi.prepare.updateIntent(input.walletName, {
    index: input.targetIntentIndex,
    file: input.templateFile,
    proposers: input.proposers,
    approvers: input.approvers,
    threshold: input.approvalThreshold,
    cancellation_threshold: input.cancellationThreshold,
    timelock: input.timelockSeconds,
    policy_ciphertexts: [],
  });
  const paramsHex = String(
    (bodyDry as { params_data_hex?: string }).params_data_hex ?? "",
  ).replace(/^0x/i, "");
  if (paramsHex.length < 4) {
    throw new Error("Could not build intent body for governance update.");
  }
  // params_data = [target_index byte][intent body]
  const newIntentBodyHex = paramsHex.slice(2);
  const committedPayload = encodeTypedGovernancePayload(
    input.targetIntentIndex,
    newIntentBodyHex,
  );
  const policyCommitment = typedGovernanceCommitmentHex(committedPayload.bytes);

  let envelope: ClearSignEnvelope<MemberPayload | ThresholdPayload>;
  if (input.kind === "change_threshold") {
    envelope = {
      version: 3,
      kind: "change_threshold",
      walletName: input.walletName,
      walletId: input.walletId,
      actionId: randomActionLabel("change-threshold"),
      nonce: randomActionLabel("nonce"),
      expiresAt,
      policyCommitment,
      payload: {
        approvalsRequired: input.approvalThreshold,
        targetIntentIndex: input.targetIntentIndex,
        proposers: input.proposers,
        approvers: input.approvers,
        cancellationThreshold: input.cancellationThreshold,
        timelockSeconds: input.timelockSeconds,
      },
    };
  } else {
    envelope = {
      version: 3,
      kind: input.kind as Extract<ClearSignActionKind, "add_member" | "remove_member">,
      walletName: input.walletName,
      walletId: input.walletId,
      actionId: randomActionLabel(input.kind),
      nonce: randomActionLabel("nonce"),
      expiresAt,
      policyCommitment,
      payload: {
        member: input.member ?? "",
        role: input.role ?? "approver",
        targetIntentIndex: input.targetIntentIndex,
        proposers: input.proposers,
        approvers: input.approvers,
        approvalThreshold: input.approvalThreshold,
        cancellationThreshold: input.cancellationThreshold,
        timelockSeconds: input.timelockSeconds,
      },
    };
  }

  const summary = await prepareClearSignAction(envelope, { fallback: false });
  const dry = await backendApi.prepare.createTypedProposal(input.walletName, {
    intent_index: input.voteIntentIndex,
    action_kind: summary.actionKindCode,
    policy_commitment: envelope.policyCommitment,
    payload_hash: summary.payloadHash,
    envelope_hash: summary.envelopeHash,
    action_id: envelope.actionId,
    nonce: envelope.nonce,
    policyBytesHex: committedPayload.hex,
    signable_text: summary.signableText,
    expiry: formatUnixSigningExpiry(envelope.expiresAt),
    actor_pubkey: input.proposerPk.toBase58(),
  });
  const signed = await input.signTypedDescriptor(dry, {
    preferSigner: input.proposerPk,
    expectedTyped: {
      envelopeHash: summary.envelopeHash,
      payloadHash: summary.payloadHash,
      signableText: summary.signableText,
    },
  });
  const submitted = await backendApi.submit.createTypedProposal(input.walletName, {
    ...signed,
    expiry: dry.expiry,
    intent_index: dry.intent_index,
    action_kind: dry.action_kind,
    policy_commitment: dry.policy_commitment_hex,
    payload_hash: dry.payload_hash_hex,
    envelope_hash: dry.envelope_hash_hex,
    action_id: dry.action_id,
    nonce: dry.nonce,
    policyBytesHex: committedPayload.hex,
  });
  const proposal = submitted.proposal;
  if (typeof proposal !== "string" || proposal.length === 0) {
    throw new Error("Backend did not return a governance proposal address.");
  }

  const approverPk =
    input.pickApprover(input.voteApprovers) ?? input.proposerPk;
  const decision = await approveIfNeeded(input.connection, proposal, {
    approvers: input.voteApprovers,
    approverPubkey: approverPk.toBase58(),
    approvalThreshold: input.voteApprovalThreshold,
  });
  if (decision.needsApproveSignature) {
    const approveDry = await backendApi.prepare.approveTypedProposal(
      input.walletName,
      proposal,
      { actor_pubkey: approverPk.toBase58() },
    );
    const approveSigned = await input.signTypedDescriptor(approveDry, {
      preferSigner: approverPk,
    });
    await backendApi.submit.approveTypedProposal(input.walletName, proposal, {
      ...approveSigned,
      expiry: approveDry.expiry,
    });
  }

  const ready = await waitForProposalApproval(input.connection, proposal);
  if (!ready) {
    return { kind: "awaiting_approvals", proposal };
  }

  await backendApi.executeTypedIntentGovernance(input.walletName, proposal, {
    actionKind: summary.actionKindCode,
    targetIndex: input.targetIntentIndex,
    newIntentBodyHex,
  });
  return { kind: "executed", proposal };
}
