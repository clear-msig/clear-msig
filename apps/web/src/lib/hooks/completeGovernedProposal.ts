import type { Connection, PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import type { DryRunDescriptor } from "@/lib/api/types";
import type {
  SignedPayload,
  SignOptions,
} from "@/lib/hooks/useSignWithWallet";

interface GovernedProposalArgs {
  connection: Connection;
  walletName: string;
  proposal: string;
  approvers: readonly string[];
  approverPubkey: string;
  approvalThreshold: number;
  signerPk: PublicKey;
  signDescriptor: (
    descriptor: DryRunDescriptor,
    options?: SignOptions,
  ) => Promise<SignedPayload>;
}

export async function completeGovernedProposal({
  connection,
  walletName,
  proposal,
  approvers,
  approverPubkey,
  approvalThreshold,
  signerPk,
  signDescriptor,
}: GovernedProposalArgs): Promise<"executed" | "awaiting_approvals"> {
  const decision = await approveIfNeeded(connection, proposal, {
    approvers,
    approverPubkey,
    approvalThreshold,
  });
  if (decision.needsApproveSignature) {
    const descriptor = await backendApi.prepare.approveProposal(
      walletName,
      proposal,
      { actor_pubkey: approverPubkey },
    );
    const signed = await signDescriptor(descriptor, { preferSigner: signerPk });
    await backendApi.submit.approveProposal(walletName, proposal, {
      ...signed,
      expiry: descriptor.expiry,
    });
  }

  const approved =
    decision.readyToExecute ||
    (await waitForProposalApproval(connection, proposal));
  if (!approved) return "awaiting_approvals";

  await backendApi.executeProposal(walletName, proposal, {});
  return "executed";
}
