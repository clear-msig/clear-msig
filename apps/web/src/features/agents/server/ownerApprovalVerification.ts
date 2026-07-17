import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import type { AgentOwnerApproval } from "@/lib/agents/types";

export function verifyAgentOwnerApprovalSignature(
  approval: AgentOwnerApproval,
): boolean {
  if (!approval.signature || !approval.approvedBy) return false;
  const signature = hexToBytes(approval.signature);
  if (!signature || signature.length !== 64) return false;
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(approval.approvedBy);
  } catch {
    return false;
  }
  const message = ownerApprovalSignableText(
    {
      walletName: approval.walletName,
      agentId: approval.agentId,
      action: approval.action,
      summary: approval.summary,
      details: approval.details,
      targetType: approval.targetType,
      targetId: approval.targetId,
    },
    approval.createdAt,
  );
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signature,
    publicKey.toBytes(),
  );
}

function hexToBytes(value: string): Uint8Array | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      normalized.slice(index * 2, index * 2 + 2),
      16,
    );
  }
  return bytes;
}
