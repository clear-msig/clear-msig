// Generated from crates/clear-msig-signing/src/{lib,model,hashing}.rs. Do not edit.
// Verification of an existing on-chain envelope; never prepares signing authority.
import { bytes, integer, digest } from "./envelopeCodec";

export interface CanonicalEnvelopeFields {
  kind: number;
  network: number;
  proposal_index: bigint;
  wallet_name: Uint8Array;
  wallet_id: Uint8Array;
  actor: Uint8Array;
  action_id: Uint8Array;
  nonce: Uint8Array;
  expires_at: bigint;
  approval_required: number;
  policy_commitment: Uint8Array;
  payload_hash: Uint8Array;
  clear_text_hash: Uint8Array;
}
export function canonicalEnvelopeHash(fields: CanonicalEnvelopeFields): string {
  if (!fields.wallet_name.length || fields.wallet_name.length > 64 ||
      fields.wallet_name.some(b => b < 32 || b > 126) ||
      !Number.isInteger(fields.approval_required) || fields.approval_required < 1 || fields.approval_required > 16 ||
      ![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].includes(fields.kind) ||
      ![1,2,3,4,5,6,7,8].includes(fields.network))
    throw new Error("Invalid canonical envelope context.");
  if (!(fields.wallet_id instanceof Uint8Array) || fields.wallet_id.length !== 32) throw new Error("Invalid wallet_id bytes.");
  if (!(fields.actor instanceof Uint8Array) || fields.actor.length !== 32) throw new Error("Invalid actor bytes.");
  if (!(fields.action_id instanceof Uint8Array) || fields.action_id.length !== 32) throw new Error("Invalid action_id bytes.");
  if (!(fields.nonce instanceof Uint8Array) || fields.nonce.length !== 32) throw new Error("Invalid nonce bytes.");
  if (!(fields.policy_commitment instanceof Uint8Array) || fields.policy_commitment.length !== 32) throw new Error("Invalid policy_commitment bytes.");
  if (!(fields.payload_hash instanceof Uint8Array) || fields.payload_hash.length !== 32) throw new Error("Invalid payload_hash bytes.");
  if (!(fields.clear_text_hash instanceof Uint8Array) || fields.clear_text_hash.length !== 32) throw new Error("Invalid clear_text_hash bytes.");
  return digest([
    bytes(new TextEncoder().encode("clearsig:policy-engine:v4")),
    integer(4, 1),
    integer(fields.kind, 1),
    integer(fields.network, 1),
    integer(fields.proposal_index, 8, false),
    bytes(fields.wallet_name),
    bytes(fields.wallet_id),
    bytes(fields.actor),
    bytes(fields.action_id),
    bytes(fields.nonce),
    integer(fields.expires_at, 8, true),
    integer(fields.approval_required, 1),
    fields.policy_commitment,
    fields.payload_hash,
    fields.clear_text_hash,
  ]);
}
