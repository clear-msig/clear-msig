import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import type { AgentOwnerApproval, AgentSessionGrant } from "@/lib/agents/types";
import { saveAgentServerOwnerApproval, saveAgentServerSession } from "./serverState";

/** Test-only signing identity. This does not establish real wallet membership. */
export function signedOwnerApproval(
  input: Pick<AgentOwnerApproval, "walletName" | "agentId" | "action" | "targetType" | "targetId"> & Partial<AgentOwnerApproval>,
): AgentOwnerApproval {
  const keypair = nacl.sign.keyPair();
  const approval = {
    id: `approval-${input.targetId}`,
    summary: "Authorize test action",
    details: [],
    approvalHash: `hash-${input.targetId}`,
    createdAt: Date.now(),
    version: 1,
    ...input,
    signatureVersion: 2,
    approvalMethod: "wallet_signature",
    approvedBy: new PublicKey(keypair.publicKey).toBase58(),
  } as AgentOwnerApproval;
  return {
    ...approval,
    signature: Buffer.from(nacl.sign.detached(
      new TextEncoder().encode(ownerApprovalSignableText(approval, approval.createdAt)),
      keypair.secretKey,
    )).toString("hex"),
  };
}

export async function saveApprovedSession(session: AgentSessionGrant): Promise<AgentSessionGrant> {
  await saveAgentServerOwnerApproval(signedOwnerApproval({
    walletName: session.walletName,
    agentId: session.agentId,
    action: "grant_allowance",
    targetType: "session",
    targetId: session.id,
  }));
  return saveAgentServerSession(session);
}
