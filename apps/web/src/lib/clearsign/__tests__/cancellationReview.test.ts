import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection, type AccountInfo } from "@solana/web3.js";
import { parseTypedProposal } from "@/lib/msig/accounts";
import {
  findWalletAddress,
  findIntentAddress,
  findTypedProposalAddress,
} from "@/lib/msig/pda";
import { canonicalReviewEnvelope } from "../proposalReview";
import {
  readCancellationContext,
  readOwnedProposalContext,
  bindCancellationDescriptor,
} from "../cancellationReview";
import { formatTimestamp } from "@/lib/msig/datetime";
import { toHex } from "@/lib/msig/hash";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const num = (n: number | bigint, size: number) => {
  let v = BigInt(n);
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
};
const vec = (value: string | Buffer) => {
  const b = Buffer.from(value);
  return Buffer.concat([num(b.length, 4), b]);
};
function fixture() {
  const file = readFileSync(
    resolve(process.cwd(), "../../tests/fixtures/clearsign-v4-transfer.txt"),
    "utf8",
  );
  const doc = file.split("---document---\n")[1].trimEnd();
  const policy = Buffer.from(doc.match(/Policy commitment: (\w+)/)![1], "hex");
  const name = "Team treasury",
    program = key(2),
    creator = key(3),
    proposer = key(4);
  const [wallet, wb] = findWalletAddress(name, creator, program),
    [intent, ib] = findIntentAddress(wallet, 3, program),
    [proposal, pb] = findTypedProposalAddress(intent, 6n, program);
  const proposalData = Buffer.concat([
    Buffer.from([6]),
    wallet.toBuffer(),
    intent.toBuffer(),
    num(6, 8),
    proposer.toBuffer(),
    Buffer.from([0, 1]),
    num(0, 8),
    num(0, 8),
    num(1784000000, 8),
    Buffer.from([pb]),
    num(0, 2),
    num(0, 2),
    proposer.toBuffer(),
    policy,
    Buffer.alloc(32, 5),
    Buffer.alloc(32),
    vec(Buffer.alloc(32, 255)),
    vec(Buffer.alloc(32, 254)),
    vec(Buffer.alloc(0)),
    vec(doc),
  ]);
  const parsed = parseTypedProposal(proposalData),
    hash = canonicalReviewEnvelope(parsed, name, 2, 1);
  // envelope follows discriminator, identity/header, refund, policy and payload.
  Buffer.from(hash, "hex").copy(proposalData, 232);
  const walletData = Buffer.concat([
    Buffer.from([1, wb]),
    num(7, 8),
    num(4, 1),
    creator.toBuffer(),
    vec(name),
  ]);
  const intentData = Buffer.concat([
    Buffer.from([2]),
    wallet.toBuffer(),
    Buffer.from([ib, 3, 0, 0, 1, 2, 2]),
    num(0, 4),
    Buffer.alloc(10),
    num(1, 4),
    proposer.toBuffer(),
    num(2, 4),
    proposer.toBuffer(),
    creator.toBuffer(),
    Buffer.alloc(4 * 7),
  ]);
  const infos: AccountInfo<Buffer>[] = [
    proposalData,
    walletData,
    intentData,
  ].map((data) => ({
    data,
    owner: program,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  }));
  const rpc = {
    getGenesisHash: vi.fn(async () => "pinned-test-genesis"),
    getAccountInfoAndContext: vi.fn(async () => ({
      context: { slot: 10 },
      value: infos[0],
    })),
    getMultipleAccountsInfoAndContext: vi.fn(async () => ({
      context: { slot: 11 },
      value: infos,
    })),
  };
  const read = (
    options = { program, expectedGenesis: "pinned-test-genesis" },
  ) =>
    readCancellationContext(
      rpc as unknown as Connection,
      proposal.toBase58(),
      name,
      options,
    );
  const readDisplay = () =>
    readOwnedProposalContext(
      rpc as unknown as Connection,
      proposal.toBase58(),
      undefined,
      { program, expectedGenesis: "pinned-test-genesis" },
    );
  return { infos, rpc, read, readDisplay, proposalData, program };
}
const now = 1783990000000;
async function bound() {
  const f = fixture(),
    context = await f.read();
  const p = context.proposal;
  if (!p.typed) throw new Error("typed fixture");
  const signer = context.intent.approvers[0];
  const text = [
    Buffer.from(p.clearTextHex!, "hex").toString(),
    "",
    "APPROVAL",
    "Decision: CANCEL",
    `Proposal: #${p.proposalIndex}`,
    `Wallet: ${context.walletName}`,
    `Requested by: ${signer}`,
    "Requirement: 2 cancellations",
    "Status if accepted: 1 of 2 cancellations",
    "",
    "EXPIRY",
    `${formatTimestamp(p.expiresAt)} UTC`,
    "",
    "PROOF",
    "ClearSign: v4",
    `Envelope: ${p.envelopeHash}`,
  ].join("\n");
  const descriptor: TypedDryRunDescriptor = {
    action: "proposal_typed_cancel",
    wallet_name: context.walletName,
    wallet_pubkey: p.wallet,
    intent_index: context.intent.intentIndex,
    intent_pubkey: p.intent,
    proposal_pubkey: context.address,
    proposal_index: Number(p.proposalIndex),
    signer_pubkey: signer,
    approval_requirement: 2,
    approval_count_after: 1,
    approval_kind: "cancellations",
    action_kind: p.actionKind,
    policy_commitment_hex: p.policyCommitment,
    payload_hash_hex: p.payloadHash,
    envelope_hash_hex: p.envelopeHash,
    action_id: p.actionId,
    nonce: p.nonce,
    message_hex: toHex(new TextEncoder().encode(text)),
    message_flavor: "clearsign_v4_document",
    expiry: Number(p.expiresAt),
  };
  return { f, context, descriptor, signer };
}
describe("cancellation target binding (synthetic RPC and descriptors)", () => {
  it("accepts the exact target, signer, cancellation quorum and stored document", async () => {
    const b = await bound();
    expect(() =>
      bindCancellationDescriptor(b.context, b.descriptor, b.signer, now),
    ).not.toThrow();
  });
  it.each([
    ["action", "proposal_typed_approve"],
    ["wallet_name", "Another wallet"],
    ["wallet_pubkey", key(10).toBase58()],
    ["intent_pubkey", key(10).toBase58()],
    ["intent_index", 9],
    ["proposal_pubkey", key(10).toBase58()],
    ["proposal_index", 7],
    ["proposal_index", 1.5],
    ["signer_pubkey", key(10).toBase58()],
    ["approval_requirement", 1],
    ["approval_count_after", 2],
    ["approval_kind", "approvals"],
    ["action_kind", 9],
    ["policy_commitment_hex", "00".repeat(32)],
    ["payload_hash_hex", "00".repeat(32)],
    ["envelope_hash_hex", "00".repeat(32)],
    ["action_id", "changed"],
    ["nonce", "changed"],
    ["expiry", 1783990001],
  ])("rejects substituted %s=%s before signing", async (field, value) => {
    const b = await bound();
    expect(() =>
      bindCancellationDescriptor(
        b.context,
        { ...b.descriptor, [field]: value },
        b.signer,
        now,
      ),
    ).toThrow();
  });
  it.each([2, 3])(
    "verifies terminal status %s for read-only history without requiring cancellability",
    async (status) => {
      const f = fixture();
      f.proposalData[105] = status;
      f.infos[2].data[37] = 0; // Removed intent remains readable historical context.
      expect((await f.readDisplay())?.proposal.status).toBe(status);
      await expect(f.read()).rejects.toThrow(/no longer active/);
    },
  );
  it.each([0, 1, 2])(
    "rejects foreign owner for displayed account %s",
    async (index) => {
      const f = fixture();
      f.infos[index].owner = key(99);
      await expect(f.readDisplay()).rejects.toThrow(/ownership/);
    },
  );
  it.each([0, 1, 2])(
    "rejects wrong PDA bump for displayed account %s",
    async (index) => {
      const f = fixture();
      const offset = [131, 1, 33][index];
      f.infos[index].data[offset] ^= 1;
      await expect(f.readDisplay()).rejects.toThrow(/PDA/);
    },
  );
  it("preserves legacy cancellation while binding its target and exact parameter bytes", async () => {
    const b = await bound();
    const proposal = {
      ...b.context.proposal,
      typed: false as const,
      paramsData: new Uint8Array([1, 2, 3]),
    };
    const context = { ...b.context, proposal };
    const descriptor = {
      ...b.descriptor,
      action: "proposal_cancel",
      params_data_hex: "010203",
    };
    expect(() =>
      bindCancellationDescriptor(context, descriptor, b.signer, now),
    ).not.toThrow();
    expect(() =>
      bindCancellationDescriptor(
        context,
        { ...descriptor, params_data_hex: "040506" },
        b.signer,
        now,
      ),
    ).toThrow(/parameters/);
    expect(() =>
      bindCancellationDescriptor(
        context,
        { ...descriptor, action: "proposal_approve" },
        b.signer,
        now,
      ),
    ).toThrow();
  });
  it("rejects altered action text even when descriptor commitments are unchanged", async () => {
    const b = await bound();
    b.descriptor.message_hex = Buffer.from(
      Buffer.from(b.descriptor.message_hex, "hex")
        .toString()
        .replace("Amount: 0.3 SOL", "Amount: 9 SOL"),
    ).toString("hex");
    expect(() =>
      bindCancellationDescriptor(b.context, b.descriptor, b.signer, now),
    ).toThrow(/document/);
  });
  it("rejects an already-cast cancellation and outsider signer", async () => {
    const b = await bound();
    b.context.proposal.cancellationBitmap = 1;
    expect(() =>
      bindCancellationDescriptor(b.context, b.descriptor, b.signer, now),
    ).toThrow();
    expect(() =>
      bindCancellationDescriptor(
        b.context,
        b.descriptor,
        key(99).toBase58(),
        now,
      ),
    ).toThrow();
  });
  it("does not require approval-review action support to cancel", async () => {
    const f = fixture();
    // Unsupported action kind does not authorize its execution by cancelling it.
    f.proposalData[106] = 11;
    const r = await f.read();
    expect(r.proposal.typed && r.proposal.actionKind).toBe(11);
  });
  it("rejects wrong owner and changed pinned network", async () => {
    const f = fixture();
    f.infos[0].owner = key(99);
    await expect(f.read()).rejects.toThrow(/ownership/);
    const g = fixture();
    g.rpc.getGenesisHash.mockResolvedValue("different");
    await expect(g.read()).rejects.toThrow(/network/);
  });
  it("fingerprints vote/authority and observed network changes", async () => {
    const f = fixture(),
      first = await f.read();
    f.proposalData[132] = 1; // approval bitmap first byte
    expect((await f.read()).fingerprint).not.toBe(first.fingerprint);
  });
});
