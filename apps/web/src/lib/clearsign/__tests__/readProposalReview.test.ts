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
import { readCanonicalProposalReview } from "../readProposalReview";
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
    readCanonicalProposalReview(
      rpc as unknown as Connection,
      proposal.toBase58(),
      name,
      options,
    );
  return { infos, rpc, read, proposalData, program };
}
describe("finalized canonical review reader (synthetic RPC; no live calls)", () => {
  it("verifies account ownership, PDAs and raw non-UTF8 commitment bytes", async () => {
    const f = fixture();
    const r = await f.read();
    expect(r.document).toContain("Amount: 0.3 SOL");
    expect(parseTypedProposal(f.proposalData).actionIdHex).toBe(
      "ff".repeat(32),
    );
    expect(f.rpc.getMultipleAccountsInfoAndContext).toHaveBeenCalledWith(
      expect.any(Array),
      { commitment: "finalized", minContextSlot: 10 },
    );
  });
  it("rejects missing deployment identity before RPC", async () => {
    const f = fixture();
    await expect(
      f.read({ program: f.program, expectedGenesis: "" }),
    ).rejects.toThrow(/genesis/);
    expect(f.rpc.getGenesisHash).not.toHaveBeenCalled();
  });
  it("rejects a different genesis", async () => {
    const f = fixture();
    f.rpc.getGenesisHash.mockResolvedValue("wrong");
    await expect(f.read()).rejects.toThrow(/network/);
  });
  it.each([0, 1, 2])("rejects foreign-owned account %s", async (index) => {
    const f = fixture();
    f.infos[index].owner = key(90);
    await expect(f.read()).rejects.toThrow(/ownership/);
  });
  it.each([0, 1, 2])("rejects executable account %s", async (index) => {
    const f = fixture();
    f.infos[index].executable = true;
    await expect(f.read()).rejects.toThrow(/ownership/);
  });
  it("rejects an older finalized slot", async () => {
    const f = fixture();
    f.rpc.getMultipleAccountsInfoAndContext.mockResolvedValue({
      context: { slot: 9 },
      value: f.infos,
    });
    await expect(f.read()).rejects.toThrow(/snapshot/);
  });
  it("rejects a proposal changing between reads", async () => {
    const f = fixture();
    const next = f.infos.map((info) => ({
      ...info,
      data: Buffer.from(info.data),
    }));
    next[0].data[137] ^= 1;
    f.rpc.getMultipleAccountsInfoAndContext.mockResolvedValue({
      context: { slot: 11 },
      value: next,
    });
    await expect(f.read()).rejects.toThrow(/changed/);
  });
  it("rejects mismatched wallet PDA and noncanonical authority boolean", async () => {
    for (const [account, offset] of [
      [1, 11],
      [2, 37],
    ]) {
      const f = fixture();
      f.infos[account].data[offset] ^= 2;
      await expect(f.read()).rejects.toThrow();
    }
  });
  it("rejects truncated documents without losing available policy parsing", async () => {
    const f = fixture();
    f.infos[0].data = f.proposalData.subarray(0, f.proposalData.length - 20);
    await expect(f.read()).rejects.toThrow(/unavailable/);
  });
});
