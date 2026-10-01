import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { PublicKey, type Connection } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executeAndVerifyLegacySetup,
  legacySetupIsFinalized,
} from "../legacySetupExecution";
import { CLEAR_WALLET_PROGRAM_ID } from "../client";
import { findIntentAddress, findProposalAddress } from "@/lib/msig/pda";
import { toHex } from "@/lib/msig/hash";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
const api = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: { executeProposal: api.execute },
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
  const [, intentBump] = findIntentAddress(wallet, 1, CLEAR_WALLET_PROGRAM_ID);
  const [governing] = findIntentAddress(wallet, 0, CLEAR_WALLET_PROGRAM_ID);
  const [proposal, proposalBump] = findProposalAddress(
    governing,
    0n,
    CLEAR_WALLET_PROGRAM_ID,
  );
  const installed = Buffer.concat([
    Buffer.from([2]),
    wallet.toBuffer(),
    Buffer.from([intentBump, 1, 3, 0, 1, 1, 1]),
    Buffer.alloc(14),
    n(1, 4),
    signer.toBuffer(),
    n(1, 4),
    signer.toBuffer(),
    Buffer.alloc(7 * 4),
  ]);
  const params = installed.subarray(1);
  const proposalBytes = Buffer.concat([
    Buffer.from([3]),
    wallet.toBuffer(),
    governing.toBuffer(),
    Buffer.alloc(8),
    signer.toBuffer(),
    Buffer.from([2]),
    Buffer.alloc(16),
    Buffer.from([proposalBump]),
    Buffer.alloc(4),
    signer.toBuffer(),
    n(params.length, 4),
    params,
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
        rpcEndpoint: "synthetic-setup",
        getGenesisHash: async () => "genesis",
        getMultipleAccountsInfoAndContext: read,
      } as unknown as Connection,
      walletName: "Synthetic",
      walletAddress: wallet,
      accountKey: "a".repeat(64),
      proposal: proposal.toBase58(),
      paramsDataHex: toHex(params),
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
describe("legacy setup execution: actual byte parsers, synthetic provider/RPC", () => {
  it("does not mark an empty response ready and locks repeat execution", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ context: { slot: 1 }, value: [null, null] });
    api.execute.mockResolvedValue({});
    await expect(executeAndVerifyLegacySetup(f.input)).rejects.toThrow(
      "outcome unknown",
    );
    expect(
      requestRecovery.executionFor("synthetic-setup", f.input.proposal)
        ?.outcome,
    ).toBe("unknown");
    await expect(executeAndVerifyLegacySetup(f.input)).rejects.toThrow(
      "already attempted",
    );
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.execute).toHaveBeenCalledWith(
      "Synthetic",
      f.input.proposal,
      {},
      { retry: false },
    );
  });
  it("a valid txid without finalized installation remains pending, never ready", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.read.mockResolvedValue({ context: { slot: 1 }, value: [null, null] });
      const txid = bs58.encode(new Uint8Array(64).fill(7));
      api.execute.mockResolvedValue({ txid, path: "meta-intent" });
      const pending = expect(
        executeAndVerifyLegacySetup(f.input),
      ).rejects.toThrow("verification pending");
      await vi.advanceTimersByTimeAsync(3000);
      await pending;
      expect(
        requestRecovery.executionFor("synthetic-setup", f.input.proposal)?.txid,
      ).toBe(txid);
    } finally {
      vi.useRealTimers();
    }
  });
  it("requires the exact finalized executed proposal and installed intent before ready", async () => {
    const f = fixture();
    expect(await legacySetupIsFinalized(f.input)).toBe(true);
    await executeAndVerifyLegacySetup(f.input);
    expect(api.execute).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledWith(expect.any(Array), {
      commitment: "finalized",
    });
  });
  it("clears the execution lock only after a later finalized installation proves completion", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce({ context: { slot: 1 }, value: [null, null] });
    api.execute.mockResolvedValue({
      txid: bs58.encode(new Uint8Array(64).fill(8)),
      path: "meta-intent",
    });
    await executeAndVerifyLegacySetup(f.input);
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(
      requestRecovery.executionFor("synthetic-setup", f.input.proposal),
    ).toBeUndefined();
  });
  it("keeps uncertain execution locked after a provider error", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ context: { slot: 1 }, value: [null, null] });
    api.execute.mockRejectedValue(new Error("network response lost"));
    await expect(executeAndVerifyLegacySetup(f.input)).rejects.toThrow(
      "outcome unknown",
    );
    expect(
      requestRecovery.executionFor("synthetic-setup", f.input.proposal)
        ?.outcome,
    ).toBe("unknown");
  });
  it.each([
    "wrong-owner",
    "unexecuted",
    "changed-definition",
    "missing-installed",
  ])("rejects %s as completion evidence", async (mode) => {
    const f = fixture();
    const proposal = f.info(Buffer.from(f.proposalBytes)),
      intent = f.info(Buffer.from(f.installed));
    if (mode === "wrong-owner") intent.owner = key(9);
    if (mode === "unexecuted") proposal.data[105] = 1;
    if (mode === "changed-definition") intent.data[38] = 2;
    f.read.mockResolvedValue({
      context: { slot: 20 },
      value: [proposal, mode === "missing-installed" ? null : intent],
    });
    expect(await legacySetupIsFinalized(f.input)).toBe(false);
  });
  it("every setup producer calls the verified shared boundary instead of discarding execute responses", () => {
    for (const file of [
      "app/app/wallet/new/page.tsx",
      "app/app/wallet/[name]/setup/page.tsx",
      "app/app/wallet/[name]/setup/eth/page.tsx",
      "app/app/wallet/[name]/setup/erc20/page.tsx",
      "features/send/routes/ZecSendPage.tsx",
      "features/send/infrastructure/setupBitcoin.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), "src", file), "utf8");
      expect(source, file).toContain(
        "setupRecovery.executeAndVerify(proposal, dry.params_data_hex)",
      );
      expect(source, file).not.toContain("await backendApi.executeProposal(");
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
      await expect(legacySetupIsFinalized(f.input)).rejects.toThrow(/identity/);
      await expect(executeAndVerifyLegacySetup(f.input)).rejects.toThrow(
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
    await expect(legacySetupIsFinalized(f.input)).rejects.toThrow("differs");
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("does not swallow a network change as finality lag and continue execution", async () => {
    const f = fixture();
    f.input.connection.getGenesisHash = vi
      .fn()
      .mockResolvedValueOnce("genesis")
      .mockResolvedValueOnce("genesis")
      .mockResolvedValue("another-chain");
    await expect(executeAndVerifyLegacySetup(f.input)).rejects.toThrow(
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
    await expect(executeAndVerifyLegacySetup(f.input)).rejects.toThrow(
      "differs",
    );
    expect(api.execute).not.toHaveBeenCalled();
  });
});
