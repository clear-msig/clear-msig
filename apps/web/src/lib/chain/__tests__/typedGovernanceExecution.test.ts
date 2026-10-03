import { parseIntent } from "@/lib/msig/accounts";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { PublicKey, type Connection } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertUnchangedRuleDefinition,
  executeAndVerifyTypedGovernance,
  typedGovernanceIsFinalized,
} from "../typedGovernanceExecution";
import { CLEAR_WALLET_PROGRAM_ID } from "../client";
import { findIntentAddress, findTypedProposalAddress } from "@/lib/msig/pda";
import { toHex } from "@/lib/msig/hash";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
const api = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: { executeTypedIntentGovernance: api.execute },
}));
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const n = (value: number, size: number) => {
  const b = Buffer.alloc(size);
  b.writeUIntLE(value, 0, size);
  return b;
};
function fixture() {
  const wallet = key(4),
    signer = key(5);
  const [, intentBump] = findIntentAddress(wallet, 3, CLEAR_WALLET_PROGRAM_ID);
  const [governing] = findIntentAddress(wallet, 2, CLEAR_WALLET_PROGRAM_ID);
  const [proposal, proposalBump] = findTypedProposalAddress(
    governing,
    0n,
    CLEAR_WALLET_PROGRAM_ID,
  );
  const installed = Buffer.concat([
    Buffer.from([2]),
    wallet.toBuffer(),
    Buffer.from([intentBump, 3, 3, 0, 1, 1, 1]),
    Buffer.alloc(14),
    n(1, 4),
    signer.toBuffer(),
    n(1, 4),
    signer.toBuffer(),
    Buffer.alloc(7 * 4),
  ]);
  const payload = Buffer.concat([Buffer.from([3]), installed.subarray(1)]);
  const proposalBytes = Buffer.concat([
    Buffer.from([6]),
    wallet.toBuffer(),
    governing.toBuffer(),
    Buffer.alloc(8),
    signer.toBuffer(),
    Buffer.from([2, 5]),
    Buffer.alloc(24),
    Buffer.from([proposalBump]),
    Buffer.alloc(4),
    signer.toBuffer(),
    Buffer.alloc(32, 1),
    Buffer.alloc(32, 2),
    Buffer.alloc(32, 3),
    Buffer.alloc(8),
    n(payload.length, 4),
    payload,
    Buffer.alloc(4),
  ]);
  const info = (data: Buffer) => ({
    data,
    owner: CLEAR_WALLET_PROGRAM_ID,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  });
  const read = vi.fn(async () => ({
    context: { slot: 10 },
    value: [info(proposalBytes), info(installed)] as (ReturnType<
      typeof info
    > | null)[],
  }));
  return {
    installed,
    proposalBytes,
    read,
    info,
    input: {
      connection: {
        rpcEndpoint: "synthetic-governance",
        getGenesisHash: async () => "genesis",
        getMultipleAccountsInfoAndContext: read,
      } as unknown as Connection,
      walletName: "Synthetic",
      walletId: wallet.toBase58(),
      accountKey: "a".repeat(64),
      proposal: proposal.toBase58(),
      voteIntentIndex: 2,
      targetIntentIndex: 3,
      actionKind: 5,
      newIntentBodyHex: toHex(installed.subarray(1)),
      policyBytesHex: toHex(payload),
      policyCommitment: "01".repeat(32),
      payloadHash: "02".repeat(32),
      envelopeHash: "03".repeat(32),
      assertCurrent: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "genesis");
  api.execute.mockReset();
  for (const entry of requestRecovery.snapshot()) {
    if (entry.phase === "execution")
      requestRecovery.resolveExecution(entry.endpoint, entry.proposal);
    else requestRecovery.acknowledgeSeparateRequest(entry.key);
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("typed governance completion: real byte parsers and synthetic provider", () => {
  it("requires finalized executed request plus the exact target body", async () => {
    const f = fixture();
    expect(await typedGovernanceIsFinalized(f.input)).toBe(true);
    await executeAndVerifyTypedGovernance(f.input);
    expect(api.execute).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledWith(expect.any(Array), {
      commitment: "finalized",
    });
  });
  it.each([
    "wrong-owner",
    "not-executed",
    "wrong-hash",
    "wrong-target",
    "missing-target",
  ])("rejects %s", async (mode) => {
    const f = fixture(),
      proposal = f.info(Buffer.from(f.proposalBytes)),
      target = f.info(Buffer.from(f.installed));
    if (mode === "wrong-owner") target.owner = key(9);
    if (mode === "not-executed") proposal.data[105] = 1;
    if (mode === "wrong-hash") f.input.envelopeHash = "09".repeat(32);
    if (mode === "wrong-target") target.data[38] = 2;
    f.read.mockResolvedValue({
      context: { slot: 12 },
      value: [proposal, mode === "missing-target" ? null : target],
    });
    expect(await typedGovernanceIsFinalized(f.input)).toBe(false);
  });
  it("empty execution response retains uncertain lock and cannot execute again", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ context: { slot: 1 }, value: [null, null] });
    api.execute.mockResolvedValue({});
    await expect(executeAndVerifyTypedGovernance(f.input)).rejects.toThrow(
      "outcome unknown",
    );
    await expect(executeAndVerifyTypedGovernance(f.input)).rejects.toThrow(
      "already attempted",
    );
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.execute.mock.calls[0][3]).toEqual({ retry: false });
    expect(
      requestRecovery.executionFor("synthetic-governance", f.input.proposal)
        ?.outcome,
    ).toBe("unknown");
  });
  it("valid txid without installed authority stays pending and retains its signature", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.read.mockResolvedValue({ context: { slot: 1 }, value: [null, null] });
    const txid = bs58.encode(new Uint8Array(64).fill(8));
    api.execute.mockResolvedValue({
      txid,
      proposal: f.input.proposal,
      path: "typed_intent_governance",
      action_kind: 5,
    });
    const result = expect(
      executeAndVerifyTypedGovernance(f.input),
    ).rejects.toThrow("verification pending");
    await vi.advanceTimersByTimeAsync(3000);
    await result;
    expect(
      requestRecovery.executionFor("synthetic-governance", f.input.proposal)
        ?.txid,
    ).toBe(txid);
  });
  it("verified finalization after submission releases only its execution lock", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce({ context: { slot: 1 }, value: [null, null] });
    api.execute.mockResolvedValue({
      txid: bs58.encode(new Uint8Array(64).fill(8)),
      proposal: f.input.proposal,
      path: "typed_intent_governance",
      action_kind: 5,
    });
    await executeAndVerifyTypedGovernance(f.input);
    expect(
      requestRecovery.executionFor("synthetic-governance", f.input.proposal),
    ).toBeUndefined();
  });
  it("the five governance callers never execute an existing request automatically", () => {
    for (const file of [
      "lib/hooks/useRemoveMember.ts",
      "lib/hooks/useUpdateMemberRole.ts",
      "lib/hooks/useUpdateTimelock.ts",
      "lib/hooks/useUpdateApprovalThreshold.ts",
      "app/app/wallet/[name]/members/add/page.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), "src", file), "utf8");
      expect(source, file).not.toContain("backendApi.executeProposal");
      expect(source, file).toContain(
        "no existing request was executed automatically",
      );
    }
  });
});

describe("pinned network identity boundary", () => {
  it.each(["missing", "wrong", "unavailable"])(
    "fails closed for %s genesis before read or execution",
    async (mode) => {
      const f = fixture();
      if (mode === "missing")
        vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "");
      if (mode === "wrong")
        f.input.connection.getGenesisHash = vi.fn(async () => "another-chain");
      if (mode === "unavailable")
        f.input.connection.getGenesisHash = vi.fn(async () => {
          throw Error("RPC unavailable");
        });
      await expect(typedGovernanceIsFinalized(f.input)).rejects.toThrow(
        /identity/,
      );
      await expect(executeAndVerifyTypedGovernance(f.input)).rejects.toThrow(
        /identity/,
      );
      expect(f.read).not.toHaveBeenCalled();
      expect(api.execute).not.toHaveBeenCalled();
    },
  );
  it("rejects an endpoint that changes chain identity while reading finality", async () => {
    const f = fixture();
    f.input.connection.getGenesisHash = vi
      .fn()
      .mockResolvedValueOnce("genesis")
      .mockResolvedValue("another-chain");
    await expect(typedGovernanceIsFinalized(f.input)).rejects.toThrow(
      "differs",
    );
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("does not swallow a network change as finality lag and continue execution", async () => {
    const f = fixture();
    f.input.connection.getGenesisHash = vi
      .fn()
      .mockResolvedValueOnce("genesis")
      .mockResolvedValueOnce("genesis")
      .mockResolvedValue("another-chain");
    await expect(executeAndVerifyTypedGovernance(f.input)).rejects.toThrow(
      "differs",
    );
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("rechecks the pinned network immediately before the execution write", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ context: { slot: 1 }, value: [null, null] });
    f.input.connection.getGenesisHash = vi
      .fn()
      .mockResolvedValueOnce("genesis")
      .mockResolvedValueOnce("genesis")
      .mockResolvedValueOnce("genesis")
      .mockResolvedValue("another-chain");
    await expect(executeAndVerifyTypedGovernance(f.input)).rejects.toThrow(
      "differs",
    );
    expect(api.execute).not.toHaveBeenCalled();
  });
});

describe("authority edits preserve executable definitions", () => {
  it("allows only the reviewed authority fields and proposal counter to differ", () => {
    const original = parseIntent(fixture().installed);
    expect(() =>
      assertUnchangedRuleDefinition(original, {
        ...original,
        approvers: [key(8).toBase58()],
        approvalThreshold: 2,
        timelockSeconds: 60,
        activeProposalCount: 1,
      }),
    ).not.toThrow();
  });
  it.each([
    "chainKind",
    "intentType",
    "template",
    "templateOffset",
    "templateLen",
    "txTemplateOffset",
    "txTemplateLen",
    "params",
    "accounts",
    "instructions",
    "dataSegments",
    "seeds",
    "bytePool",
    "policyCiphertexts",
    "policyCiphertextIds",
  ] as const)("rejects an implicit change to %s", (field) => {
    const original = parseIntent(fixture().installed);
    const altered = {
      ...original,
      [field]:
        field === "template"
          ? "different rule"
          : typeof original[field] === "number"
            ? 999
            : [1],
    };
    expect(() =>
      assertUnchangedRuleDefinition(original, altered as typeof original),
    ).toThrow("existing rule definition");
  });
});
