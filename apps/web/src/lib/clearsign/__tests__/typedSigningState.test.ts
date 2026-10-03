import { beforeEach, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { captureTypedSigningState } from "../typedSigningState";
import { CLEAR_WALLET_PROGRAM_ID as program } from "@/lib/chain/client";
import { findWalletAddress, findIntentAddress, findWalletPolicyAddress, findTypedProposalAddress } from "@/lib/msig/pda";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
const parsers = vi.hoisted(() => ({ wallet: vi.fn(), intent: vi.fn(), policy: vi.fn(), proposal: vi.fn() }));
vi.mock("@/lib/msig/accounts", () => ({ parseWallet: parsers.wallet, parseIntent: parsers.intent, parseWalletPolicy: parsers.policy, parseAnyProposal: parsers.proposal }));
const creator = new PublicKey(new Uint8Array(32).fill(1));
const [wallet, wb] = findWalletAddress("Treasury", creator, program);
const [intent, ib] = findIntentAddress(wallet, 3, program);
const [proposal] = findTypedProposalAddress(intent, 6n, program);
const descriptor = { proposal_pubkey: proposal.toBase58(), proposal_index: 6, wallet_pubkey: wallet.toBase58(), wallet_name: "Treasury", intent_pubkey: intent.toBase58(), intent_index: 3, signer_pubkey: creator.toBase58(), approval_requirement: 1, approval_count_after: 1, action: "proposal_typed_create", action_kind: 1 } as TypedDryRunDescriptor;
const authority = { wallet: wallet.toBase58(), bump: ib, intentIndex: 3, approved: true, approvers: [creator.toBase58()], proposers: [creator.toBase58()], approvalThreshold: 1, cancellationThreshold: 1, chainKind: 0, timelockSeconds: 0, activeProposalCount: 0, params: [{ constraintValue: 0n }] };
function fixture() {
  const owned = { owner: program, executable: false, data: Buffer.from([1]) };
  const rpc = vi.fn().mockResolvedValue({ context: { slot: 100 }, value: [owned, owned, null, null] });
  return { rpc, owned, connection: { getMultipleAccountsInfoAndContext: rpc } as unknown as Connection };
}
beforeEach(() => { parsers.wallet.mockReturnValue({ name: "Treasury", creator: creator.toBase58(), bump: wb, proposalIndex: 6n }); parsers.intent.mockReturnValue(authority); parsers.proposal.mockReturnValue({ typed: true, wallet: wallet.toBase58(), intent: intent.toBase58(), proposalIndex: 6n, status: 0, actionKind: 1, policyCommitment: undefined, payloadHash: undefined, envelopeHash: undefined, cancellationBitmap: 0, approvalBitmap: 0 }); });
it("allows unchanged authority and rejects a counter change within one review", async () => {
  const f = fixture(); const check = await captureTypedSigningState(f.connection, descriptor);
  await expect(check()).resolves.toBeUndefined();
  parsers.intent.mockReturnValue({ ...authority, activeProposalCount: 1 });
  await expect(check()).rejects.toThrow("changed during review");
  const nextStep = await captureTypedSigningState(f.connection, descriptor);
  await expect(nextStep()).resolves.toBeUndefined();
});
it("rejects role/timelock changes during exact-message review", async () => {
  const f = fixture(); const check = await captureTypedSigningState(f.connection, descriptor);
  parsers.intent.mockReturnValue({ ...authority, timelockSeconds: 5 });
  await expect(check()).rejects.toThrow();
});
it("rejects changed approval requirement before showing review", async () => {
  const f = fixture(); parsers.intent.mockReturnValue({ ...authority, approvalThreshold: 2 });
  await expect(captureTypedSigningState(f.connection, descriptor)).rejects.toThrow("threshold changed");
});
it("fails closed on RPC errors, stale context slots and wrong ownership", async () => {
  const f = fixture(); const check = await captureTypedSigningState(f.connection, descriptor);
  f.rpc.mockRejectedValueOnce(new Error("RPC failed")); await expect(check()).rejects.toThrow("RPC failed");
  f.rpc.mockResolvedValueOnce({ context: { slot: 99 }, value: [f.owned, f.owned, null, null] }); await expect(check()).rejects.toThrow("snapshot is stale");
  f.rpc.mockResolvedValueOnce({ context: { slot: 101 }, value: [{ ...f.owned, owner: creator }, f.owned, null, null] }); await expect(check()).rejects.toThrow("ownership");
});

it("keeps cancellation available for a transfer prepared under a previous policy", async () => {
  const f = fixture(); const [, bump] = findWalletPolicyAddress(wallet, program);
  parsers.policy.mockReturnValue({ wallet: wallet.toBase58(), bump, policyCommitments: ["aa".repeat(32)] });
  f.rpc.mockResolvedValue({ context: { slot: 100 }, value: [f.owned, f.owned, f.owned, f.owned] });
  const stale = { ...descriptor, policy_commitment_hex: "bb".repeat(32) };
  await expect(captureTypedSigningState(f.connection, stale)).rejects.toThrow("protection differs");
  parsers.proposal.mockReturnValue({ ...parsers.proposal(), policyCommitment: stale.policy_commitment_hex });
  const check = await captureTypedSigningState(f.connection, { ...stale, action: "proposal_typed_cancel" });
  await expect(check()).resolves.toBeUndefined();
});

it("rejects a changed vote bitmap during approval review", async () => {
  const f = fixture(); f.rpc.mockResolvedValue({ context: { slot: 100 }, value: [f.owned, f.owned, null, f.owned] });
  const check = await captureTypedSigningState(f.connection, { ...descriptor, action: "proposal_typed_approve" });
  parsers.proposal.mockReturnValue({ typed: true, wallet: wallet.toBase58(), intent: intent.toBase58(), proposalIndex: 6n, status: 0, actionKind: 1, policyCommitment: undefined, payloadHash: undefined, envelopeHash: undefined, cancellationBitmap: 0, approvalBitmap: 1 });
  await expect(check()).rejects.toThrow();
});

it("rejects a stale initial creation counter", async () => {
  const f = fixture(); parsers.wallet.mockReturnValue({ name: "Treasury", creator: creator.toBase58(), bump: wb, proposalIndex: 7n });
  await expect(captureTypedSigningState(f.connection, descriptor)).rejects.toThrow("creation index is stale");
});
it("allows replacing an opposite vote but blocks repeating the same vote", async () => {
  const f = fixture(); f.rpc.mockResolvedValue({ context: { slot: 100 }, value: [f.owned, f.owned, null, f.owned] });
  parsers.proposal.mockReturnValue({ ...parsers.proposal(), approvalBitmap: 1, cancellationBitmap: 0 });
  await expect(captureTypedSigningState(f.connection, { ...descriptor, action: "proposal_typed_cancel" })).resolves.toBeTypeOf("function");
  await expect(captureTypedSigningState(f.connection, { ...descriptor, action: "proposal_typed_approve" })).rejects.toThrow("already voted");
});
