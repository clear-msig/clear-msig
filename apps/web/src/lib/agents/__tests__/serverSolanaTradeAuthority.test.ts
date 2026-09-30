import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  findWalletAddress,
  findIntentAddress,
  findTypedProposalAddress,
  findAgentRiskAddress,
} from "@/lib/msig/pda";
import { createSolanaTradeAuthorityReader } from "../serverSolanaTradeAuthority";
import {
  agentVenueOrderRoute,
  hashText,
  type AgentVenueOrderV2,
} from "../serverVenueOrderContract";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const number = (value: bigint | number, size: number) => {
  let n = BigInt(value);
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = Number(n & 255n);
    n >>= 8n;
  }
  return bytes;
};
const vector = (value: string | Buffer) => {
  const b = Buffer.from(value);
  return Buffer.concat([number(b.length, 4), b]);
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest();
const digest = (s: string) => Buffer.from(s, "hex");

// Synthetic program-layout fixtures. Encodings follow the checked-in Rust
// state structs and hashing.rs; they are not live chain execution evidence.
function fixture() {
  const program = key(2);
  const creator = key(3);
  const proposer = key(4);
  const name = "Test wallet";
  const [wallet, walletBump] = findWalletAddress(name, creator, program);
  const [intent, intentBump] = findIntentAddress(wallet, 3, program);
  const [proposal, proposalBump] = findTypedProposalAddress(
    intent,
    8n,
    program,
  );
  const policyBytes = Buffer.alloc(0);
  const policyCommitment = sha(
    Buffer.concat([
      vector("clearsig:policy-engine:v2:policy"),
      number(2, 4),
      vector("typed-sol-send-policy-v1"),
      vector(policyBytes),
    ]),
  ).toString("hex");
  const order: AgentVenueOrderV2 = {
    version: 2,
    chainGenesisHash: key(1).toBase58(),
    programId: program.toBase58(),
    walletPda: wallet.toBase58(),
    actionId: "trade-1",
    sessionIdHash: hashText("session-1"),
    agentIdHash: hashText("agent-1"),
    policyCommitment,
    riskCheckHash: hashText("risk-1"),
    venue: "hyperliquid_testnet",
    accountAddress: `0x${"1".repeat(40)}`,
    agentWalletAddress: `0x${"2".repeat(40)}`,
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsdRaw: "250000000",
    leverageX100: 100,
    leverageMode: "isolated",
    maxSlippageBps: 50,
    stopLossPrice: "60000",
    takeProfitPrice: "80000",
    expiresAtMs: 1800000060000,
  };
  const payload = sha(
    Buffer.concat([
      vector("clearsig:policy-engine:v2:payload"),
      number(9, 1),
      ...[
        order.agentIdHash,
        hashText(order.venue),
        hashText(order.market),
        hashText(order.side),
        hashText(`USDC:${order.venue}`),
      ].map((v) => vector(digest(v))),
      number(BigInt(order.notionalUsdRaw), 16),
      number(order.leverageX100, 4),
      ...[
        order.sessionIdHash,
        hashText(agentVenueOrderRoute(order)),
        order.riskCheckHash,
      ].map((v) => vector(digest(v))),
    ]),
  );
  const actionId = digest(hashText(order.actionId));
  const nonce = digest(hashText("nonce-1"));
  const document = Buffer.from(
    "ClearSig\nProtocol: clearsig-intent-v4@1\nSynthetic test document",
  );
  const envelope = sha(
    Buffer.concat([
      vector("clearsig:policy-engine:v4"),
      Buffer.from([4, 9, 7]),
      number(8, 8),
      vector(name),
      vector(wallet.toBuffer()),
      vector(proposer.toBuffer()),
      vector(actionId),
      vector(nonce),
      number(order.expiresAtMs / 1000, 8),
      number(2, 1),
      digest(policyCommitment),
      payload,
      sha(document),
    ]),
  );
  const proposalData = Buffer.concat([
    Buffer.from([6]),
    wallet.toBuffer(),
    intent.toBuffer(),
    number(8, 8),
    proposer.toBuffer(),
    Buffer.from([2, 9]),
    number(1800000000, 8),
    number(1800000001, 8),
    number(order.expiresAtMs / 1000, 8),
    number(proposalBump, 1),
    number(3, 2),
    number(0, 2),
    creator.toBuffer(),
    digest(policyCommitment),
    payload,
    envelope,
    vector(actionId),
    vector(nonce),
    vector(policyBytes),
    vector(document),
  ]);
  const walletData = Buffer.concat([
    Buffer.from([1, walletBump]),
    number(9, 8),
    number(4, 1),
    creator.toBuffer(),
    vector(name),
  ]);
  const intentData = Buffer.concat([
    Buffer.from([2]),
    wallet.toBuffer(),
    Buffer.from([intentBump, 3, 0, 5, 1, 2, 2]),
    number(0, 4),
    Buffer.alloc(10),
    number(1, 4),
    proposer.toBuffer(),
    number(2, 4),
    proposer.toBuffer(),
    creator.toBuffer(),
    Buffer.alloc(4 * 7),
  ]);
  const [session, sessionBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("agent_session"),
      wallet.toBuffer(),
      digest(order.sessionIdHash),
    ],
    program,
  );
  const [risk, riskBump] = findAgentRiskAddress(
    wallet,
    digest(order.sessionIdHash),
    program,
  );
  const sessionData = Buffer.concat([
    Buffer.from([9]),
    wallet.toBuffer(),
    ...[
      order.sessionIdHash,
      order.agentIdHash,
      hashText(order.venue),
      hashText(order.market),
      policyCommitment,
    ].map(digest),
    number(500000000, 16),
    number(200, 4),
    number(1800000120, 8),
    number(250000000, 16),
    Buffer.from([1, sessionBump]),
  ]);
  const riskData = Buffer.concat([
    Buffer.from([10]),
    wallet.toBuffer(),
    digest(order.sessionIdHash),
    digest(hashText("oracle")),
    number(100000000, 16),
    number(0, 16),
    number(250000000, 16),
    number(0, 8),
    Buffer.alloc(32),
    Buffer.from([1, riskBump]),
  ]);
  const infos: AccountInfo<Buffer>[] = [
    proposalData,
    walletData,
    intentData,
    sessionData,
    riskData,
  ].map((data) => ({
    data,
    executable: false,
    owner: program,
    lamports: 1,
    rentEpoch: 0,
  }));
  const addresses = [proposal, wallet, intent, session, risk].map((v) =>
    v.toBase58(),
  );
  const rpc = {
    getGenesisHash: vi.fn(async () => order.chainGenesisHash),
    getMultipleAccountsInfoAndContext: vi.fn(
      async (
        keys: PublicKey[],
        _config?: Parameters<
          Connection["getMultipleAccountsInfoAndContext"]
        >[1],
      ) => ({
        context: { slot: 100 },
        value: keys.map((k) => infos[addresses.indexOf(k.toBase58())] ?? null),
      }),
    ),
  };
  const limits = {
    policyCommitment,
    maxOpenPositions: 2,
    cooldownMs: 1000,
    dailyLossCapRaw: "100000000",
    requireTakeProfit: true,
  };
  const resolveCommittedLimits = vi.fn(async () => limits);
  const read = createSolanaTradeAuthorityReader({
    rpc,
    deployment: {
      chainGenesisHash: order.chainGenesisHash,
      programId: order.programId,
    },
    resolveCommittedLimits,
  });
  return {
    order,
    infos,
    rpc,
    read,
    resolveCommittedLimits,
    proposal: proposal.toBase58(),
    policyCommitment,
  };
}

describe("finalized canonical Solana trade reader", () => {
  it("derives all accounts and validates exact v4 payload/envelope with finalized minContextSlot", async () => {
    const f = fixture();
    const authority = await f.read(f.proposal, f.order);
    expect(authority).toMatchObject({
      finalized: true,
      status: "executed",
      approvals: 2,
      threshold: 2,
      session: { active: true, spentNotionalRaw: "250000000" },
      risk: { active: true, openNotionalRaw: "250000000" },
    });
    expect(f.rpc.getMultipleAccountsInfoAndContext.mock.calls[1][1]).toEqual({
      commitment: "finalized",
      minContextSlot: 100,
    });
    expect(f.resolveCommittedLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        policyCommitment: f.policyCommitment,
        policyBytes: new Uint8Array(),
      }),
    );
  });
  it("rejects another genesis without reading accounts", async () => {
    const f = fixture();
    f.rpc.getGenesisHash.mockResolvedValue(key(9).toBase58());
    await expect(f.read(f.proposal, f.order)).rejects.toThrow("genesis");
    expect(f.rpc.getMultipleAccountsInfoAndContext).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3, 4])(
    "rejects wrong owner for snapshot account %s",
    async (index) => {
      const f = fixture();
      f.infos[index].owner = key(9);
      await expect(f.read(f.proposal, f.order)).rejects.toThrow("owned");
      expect(f.resolveCommittedLimits).not.toHaveBeenCalled();
    },
  );
  it.each([
    "status",
    "kind",
    "bitmap",
    "bump",
    "envelope",
    "policy",
    "truncated",
    "sessionBump",
    "riskStatus",
  ])("rejects malformed %s evidence", async (kind) => {
    const f = fixture();
    const p = f.infos[0].data;
    if (kind === "status") p[105] = 1;
    if (kind === "kind") p[106] = 14;
    if (kind === "bitmap") p.writeUInt16LE(5, 132);
    if (kind === "bump") p[131] ^= 1;
    if (kind === "envelope") p[232] ^= 1;
    if (kind === "policy") p[168] ^= 1;
    if (kind === "truncated") f.infos[0].data = p.subarray(0, 150);
    if (kind === "sessionBump") f.infos[3].data[238] ^= 1;
    if (kind === "riskStatus") f.infos[4].data[185] = 99;
    await expect(f.read(f.proposal, f.order)).rejects.toThrow();
    expect(f.resolveCommittedLimits).not.toHaveBeenCalled();
  });
  it.each([
    { stopLossPrice: "59000" },
    { notionalUsdRaw: "250000001" },
    { accountAddress: `0x${"3".repeat(40)}` },
    { actionId: "other-action" },
  ])("rejects changed exact order %j", async (change) => {
    const f = fixture();
    await expect(f.read(f.proposal, { ...f.order, ...change })).rejects.toThrow(
      "exact venue order",
    );
  });
  it("rejects a regressing finalized slot", async () => {
    const f = fixture();
    const original =
      f.rpc.getMultipleAccountsInfoAndContext.getMockImplementation()!;
    let calls = 0;
    f.rpc.getMultipleAccountsInfoAndContext.mockImplementation(
      async (keys) => ({
        ...(await original(keys)),
        context: { slot: ++calls === 1 ? 100 : 99 },
      }),
    );
    await expect(f.read(f.proposal, f.order)).rejects.toThrow("snapshot");
  });
  it("rejects a proposal changed between the two finalized reads", async () => {
    const f = fixture();
    const original =
      f.rpc.getMultipleAccountsInfoAndContext.getMockImplementation()!;
    let calls = 0;
    f.rpc.getMultipleAccountsInfoAndContext.mockImplementation(async (keys) => {
      if (++calls === 2) f.infos[0].data[132] ^= 1;
      return original(keys);
    });
    await expect(f.read(f.proposal, f.order)).rejects.toThrow("changed during");
    expect(f.resolveCommittedLimits).not.toHaveBeenCalled();
  });
  it("rejects limits resolved under a different policy commitment", async () => {
    const f = fixture();
    f.resolveCommittedLimits.mockResolvedValue({
      policyCommitment: "a".repeat(64),
      maxOpenPositions: 2,
      cooldownMs: 1000,
      dailyLossCapRaw: "100000000",
      requireTakeProfit: true,
    });
    await expect(f.read(f.proposal, f.order)).rejects.toThrow(
      "canonical policy",
    );
  });
  it("fails closed if the committed limits resolver is unavailable or mismatched", async () => {
    const f = fixture();
    f.resolveCommittedLimits.mockRejectedValue(new Error("policy unavailable"));
    await expect(f.read(f.proposal, f.order)).rejects.toThrow(
      "policy unavailable",
    );
  });
});
