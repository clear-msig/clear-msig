import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";
import { parseIntent, parseWallet, parseWalletPolicy, parseAnyProposal } from "@/lib/msig/accounts";
import { findIntentAddress, findWalletAddress, findWalletPolicyAddress, findTypedProposalAddress } from "@/lib/msig/pda";
import { sha256, toHex } from "@/lib/msig/hash";

/** Recheck current authority and protection around user review; program remains final authority. */
export async function captureTypedSigningState(connection: Connection, descriptor: TypedDryRunDescriptor) {
  const program = CLEAR_WALLET_PROGRAM_ID;
  const walletKey = new PublicKey(descriptor.wallet_pubkey);
  const intentKey = new PublicKey(descriptor.intent_pubkey);
  if (!Number.isSafeInteger(descriptor.proposal_index) || descriptor.proposal_index < 0) throw new Error("Invalid prepared proposal index.");
  const [expectedProposal] = findTypedProposalAddress(intentKey, BigInt(descriptor.proposal_index), program);
  const proposalKey = new PublicKey(descriptor.proposal_pubkey);
  if (!proposalKey.equals(expectedProposal)) throw new Error("Prepared request address differs from its intent and index.");
  const [policyKey, policyBump] = findWalletPolicyAddress(walletKey, program);
  const owned = (info: AccountInfo<Buffer> | null, max: number) => {
    if (!info || !info.owner.equals(program) || info.executable || info.data.length > max)
      throw new Error("Signing authority account is unavailable or has unexpected ownership.");
    return new Uint8Array(info.data);
  };
  let slot = 0;
  const read = async () => {
    const snapshot = await connection.getMultipleAccountsInfoAndContext([walletKey, intentKey, policyKey, proposalKey], {
      commitment: DEFAULT_COMMITMENT, minContextSlot: slot,
    });
    if (snapshot.context.slot < slot || snapshot.value.length !== 4) throw new Error("Signing authority snapshot is stale.");
    slot = snapshot.context.slot;
    const walletBytes = owned(snapshot.value[0], 512), intentBytes = owned(snapshot.value[1], 65536);
    const wallet = parseWallet(walletBytes), intent = parseIntent(intentBytes);
    const [expectedWallet, wb] = findWalletAddress(wallet.name, new PublicKey(wallet.creator), program);
    const [expectedIntent, ib] = findIntentAddress(walletKey, descriptor.intent_index, program);
    if (!expectedWallet.equals(walletKey) || wallet.bump !== wb || wallet.name !== descriptor.wallet_name ||
        !expectedIntent.equals(intentKey) || intent.bump !== ib || intent.wallet !== walletKey.toBase58() ||
        intent.intentIndex !== descriptor.intent_index || !intent.approved)
      throw new Error("Signing authority differs from the prepared request.");
    const creating = ["proposal_typed_create", "propose"].includes(descriptor.action);
    const cancelling = ["proposal_typed_cancel", "cancel"].includes(descriptor.action);
    const members = creating ? intent.proposers : intent.approvers;
    const threshold = cancelling ? intent.cancellationThreshold : intent.approvalThreshold;
    if (!members.includes(descriptor.signer_pubkey) || threshold !== descriptor.approval_requirement)
      throw new Error("Signer or approval threshold changed. Prepare and review again.");
    const policyBytes = snapshot.value[2] ? owned(snapshot.value[2], 512) : null;
    if (policyBytes) {
      const policy = parseWalletPolicy(policyBytes);
      if (policy.wallet !== walletKey.toBase58() || policy.bump !== policyBump)
        throw new Error("Wallet protection identity mismatch.");
      // Transfers must bind the currently active chain protection. Setting a
      // protection is a distinct governance action that intentionally replaces it.
      const active = policy.policyCommitments[intent.chainKind];
      if (!cancelling && descriptor.action_kind === 1 && active && active !== "00".repeat(32) && active !== descriptor.policy_commitment_hex)
        throw new Error("Active wallet protection differs from this transfer. Prepare a new request.");
    }
    let proposal = null;
    if (creating) {
      if (wallet.proposalIndex !== BigInt(descriptor.proposal_index)) throw new Error("Prepared creation index is stale. Prepare a new request.");
      if (descriptor.approval_count_after !== (intent.approvers.includes(descriptor.signer_pubkey) ? 1 : 0))
        throw new Error("Prepared creation approval count differs from current authority.");
      if (snapshot.value[3]) throw new Error("This request address is already used. Open the existing request instead of signing again.");
    } else {
      proposal = parseAnyProposal(owned(snapshot.value[3], 5000));
      if (!proposal.typed || proposal.wallet !== walletKey.toBase58() || proposal.intent !== intentKey.toBase58() ||
          proposal.proposalIndex !== BigInt(descriptor.proposal_index) ||
          (cancelling ? ![0, 1].includes(proposal.status) : proposal.status !== 0))
        throw new Error("Request state changed or voting is no longer available. Refresh the request.");
      if (proposal.actionKind !== descriptor.action_kind || proposal.policyCommitment !== descriptor.policy_commitment_hex ||
          proposal.payloadHash !== descriptor.payload_hash_hex || proposal.envelopeHash !== descriptor.envelope_hash_hex)
        throw new Error("Prepared vote differs from the stored request. Refresh and review again.");
      const bitmap = cancelling ? proposal.cancellationBitmap : proposal.approvalBitmap;
      const memberIndex = intent.approvers.indexOf(descriptor.signer_pubkey);
      const count = bitmap.toString(2).replace(/0/g, "").length;
      if ((bitmap & (1 << memberIndex)) !== 0 || descriptor.approval_count_after !== count + 1)
        throw new Error("Vote count changed or this signer already voted. Refresh the request.");
    }
    // Each signature gets a fresh baseline. Counters/status/votes may change
    // between separate steps, but must not change while this review is open.
    const data = JSON.stringify([wallet, intent, proposal, policyBytes ? toHex(policyBytes) : null], (_key, value) => typeof value === "bigint" ? value.toString() : value);
    return toHex(sha256(new TextEncoder().encode(data)));
  };
  const captured = await read();
  return async () => {
    if (await read() !== captured) throw new Error("Signing authority or wallet protection changed during review. Prepare again.");
  };
}
