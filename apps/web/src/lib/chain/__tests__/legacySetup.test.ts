import { setupBitcoin } from "@/features/send/infrastructure/setupBitcoin";
import type { WalletValue } from "@/lib/wallet/context";
import { parseIntent } from "@/lib/msig/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  withAutomaticLegacySetup,
  assertNewWalletSetupSupported,
  assertLegacySetupNetwork,
} from "../legacySetup";
import { CLEAR_WALLET_PROGRAM_ID } from "../client";
import { findWalletAddress, findIntentAddress } from "@/lib/msig/pda";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
const operations = vi.hoisted(() => ({
  prepare: vi.fn(),
  encrypt: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { addIntent: operations.prepare },
    submit: { addIntent: operations.submit },
  },
}));
vi.mock("@/lib/encrypt/client", () => ({
  encryptPolicyBatch: operations.encrypt,
}));
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const num = (value: number, size: number) => {
  const b = Buffer.alloc(size);
  let v = BigInt(value);
  for (let i = 0; i < size; i++) {
    b[i] = Number(v & 255n);
    v >>= 8n;
  }
  return b;
};
const vec = (s: string) => {
  const b = Buffer.from(s);
  return Buffer.concat([num(b.length, 4), b]);
};
function fixture(threshold = 1, separatePayer = false) {
  const signer = key(4),
    name = "Setup wallet";
  const creator = separatePayer ? key(7) : signer;
  const [wallet, wb] = findWalletAddress(
    name,
    creator,
    CLEAR_WALLET_PROGRAM_ID,
  );
  const [, ib] = findIntentAddress(wallet, 0, CLEAR_WALLET_PROGRAM_ID);
  const walletData = Buffer.concat([
    Buffer.from([1, wb]),
    num(0, 8),
    num(2, 1),
    creator.toBuffer(),
    vec(name),
  ]);
  const intentData = Buffer.concat([
    Buffer.from([2]),
    wallet.toBuffer(),
    Buffer.from([ib, 0, 0, 0, 1, threshold, 1]),
    num(0, 4),
    Buffer.alloc(10),
    num(1, 4),
    signer.toBuffer(),
    num(1, 4),
    signer.toBuffer(),
    Buffer.alloc(4 * 7),
  ]);
  const values = [walletData, intentData].map((data) => ({
    data,
    owner: CLEAR_WALLET_PROGRAM_ID,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  }));
  const rpc = {
    getGenesisHash: vi.fn(async () => "test-genesis"),
    getMultipleAccountsInfoAndContext: vi.fn(async () => ({
      context: { slot: 10 },
      value: values,
    })),
  };
  return {
    values,
    intentData,
    input: {
      connection: rpc as unknown as Connection,
      walletName: name,
      walletAddress: wallet,
      signer,
      expectedGenesis: "test-genesis",
      accountKey: "aa".repeat(32),
      template: "test-template",
    },
  };
}
beforeEach(() => {
  for (const entry of requestRecovery.snapshot())
    if (!entry.phase) requestRecovery.acknowledgeSeparateRequest(entry.key);
});
const producers = ["BTC", "ZEC", "SOL", "EVM", "ERC20", "new-wallet"];
describe("legacy setup producer preflight (real account parsing, mocked RPC/operations)", () => {
  it.each(producers)(
    "%s rejects approval-dependent setup before prepare/sign/submit",
    async (template) => {
      const f = fixture(2);
      const prepare = vi.fn(),
        sign = vi.fn(),
        submit = vi.fn();
      await expect(
        withAutomaticLegacySetup({ ...f.input, template }, async () => {
          await prepare();
          await sign();
          await submit();
        }),
      ).rejects.toThrow("canonical install-intent");
      expect(prepare).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it("retains threshold1 proposer-as-approver producer path", async () => {
    const f = fixture();
    const create = vi.fn(async (authority) => authority.approvalThreshold);
    await expect(withAutomaticLegacySetup(f.input, create)).resolves.toBe(1);
    expect(create).toHaveBeenCalledOnce();
  });
  it.each(["owner", "wallet", "unapproved", "signer", "genesis"])(
    "blocks unverifiable %s before producer",
    async (fault) => {
      const f = fixture();
      if (fault === "owner") f.values[1].owner = key(6);
      if (fault === "wallet") f.intentData[1] ^= 1;
      if (fault === "unapproved") f.intentData[37] = 0;
      if (fault === "signer") f.input.signer = key(8);
      if (fault === "genesis") f.input.expectedGenesis = "wrong";
      const create = vi.fn();
      await expect(withAutomaticLegacySetup(f.input, create)).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    },
  );
  it("blocks multi-approver new-wallet setup before wallet provisioning begins", () => {
    const me = key(4).toBase58(),
      other = key(5).toBase58();
    expect(() =>
      assertNewWalletSetupSupported([me, other], [me, other], 2, me),
    ).toThrow("No setup proposal was created");
    expect(() =>
      assertNewWalletSetupSupported([me], [me], 1, me),
    ).not.toThrow();
  });
  it("retains unknown setup identity and prevents duplicate creation after lost response", async () => {
    const f = fixture(),
      proposal = key(9).toBase58();
    await expect(
      withAutomaticLegacySetup(f.input, async (_authority, recovery) => {
        recovery.submitting(proposal);
        throw Error("lost response");
      }),
    ).rejects.toThrow("lost response");
    const create = vi.fn();
    await expect(withAutomaticLegacySetup(f.input, create)).rejects.toThrow(
      "uncertain",
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("all six actual setup routes enter this producer seam, with no manual legacy approval fallback", () => {
    for (const file of [
      "features/send/infrastructure/setupBitcoin.ts",
      "features/send/routes/ZecSendPage.tsx",
      "app/app/wallet/[name]/setup/page.tsx",
      "app/app/wallet/[name]/setup/eth/page.tsx",
      "app/app/wallet/[name]/setup/erc20/page.tsx",
      "app/app/wallet/new/page.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), "src", file), "utf8");
      expect(source).toContain("return withAutomaticLegacySetup(");
      expect(source).toContain("setupRecovery.submitting(dry.proposal_pubkey)");
      expect(source).not.toContain("prepare.approveProposal");
    }
  });
  it("supports a backend payer creator different from the one approving member", async () => {
    const f = fixture(1, true);
    const create = vi.fn(async () => "prepared");
    await expect(withAutomaticLegacySetup(f.input, create)).resolves.toBe(
      "prepared",
    );
    expect(create).toHaveBeenCalledOnce();
  });
  it("actual BTC setup producer performs zero prepare/sign/submit for unsupported governing threshold", async () => {
    const f = fixture(2);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "test-genesis");
    const sign = vi.fn();
    const wallet = {
      publicKey: f.input.signer,
      pickSigner: () => f.input.signer,
      sessionSubject: "test-subject",
    } as unknown as WalletValue;
    await expect(
      setupBitcoin({
        assertCurrent: () => {},
        wallet,
        connection: f.input.connection,
        name: f.input.walletName,
        hasBinding: true,
        walletData: { pda: f.input.walletAddress },
        intents: [
          {
            pda: findIntentAddress(
              f.input.walletAddress,
              0,
              CLEAR_WALLET_PROGRAM_ID,
            )[0],
            index: 0,
            account: parseIntent(f.intentData),
          },
        ],
        signDescriptor: sign,
      }),
    ).rejects.toThrow("canonical install-intent");
    expect(operations.encrypt).not.toHaveBeenCalled();
    expect(operations.prepare).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(operations.submit).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("validates required network identity before new-wallet provisioning", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "");
    const f = fixture();
    const createWallet = vi.fn();
    await expect(
      (async () => {
        await assertLegacySetupNetwork(f.input.connection);
        await createWallet();
      })(),
    ).rejects.toThrow("Nothing was created");
    expect(createWallet).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    const source = readFileSync(
      resolve(process.cwd(), "src/app/app/wallet/new/page.tsx"),
      "utf8",
    );
    expect(
      source.indexOf("await assertLegacySetupNetwork(connection)"),
    ).toBeLessThan(source.indexOf("await backendApi.createWallet"));
    expect(source).toContain("await fetchWalletByName(connection, walletSlug)");
  });
});

describe("setup lifecycle and finalization boundaries", () => {
  it("waits for a missing new-wallet finalized snapshot then validates the real authority", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const read = vi.mocked(
        f.input.connection.getMultipleAccountsInfoAndContext,
      );
      read.mockResolvedValueOnce({ context: { slot: 9 }, value: [null, null] });
      const create = vi.fn(async () => "ready");
      const pending = withAutomaticLegacySetup(
        { ...f.input, waitForFinalization: true },
        create,
      );
      await vi.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toBe("ready");
      expect(read).toHaveBeenCalledTimes(2);
      expect(
        read.mock.calls.every(
          (call) =>
            typeof call[1] === "object" && call[1].commitment === "finalized",
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("a delayed setup signing completion cannot submit after its lifecycle expires", async () => {
    const f = fixture();
    let current = true;
    const submit = vi.fn();
    const attempt = withAutomaticLegacySetup(
      {
        ...f.input,
        assertCurrent: () => {
          if (!current) throw new Error("page changed");
        },
      },
      async (_authority, recovery) => {
        await Promise.resolve();
        current = false;
        recovery.submitting(key(8).toBase58());
        submit();
      },
    );
    await expect(attempt).rejects.toThrow("page changed");
    expect(submit).not.toHaveBeenCalled();
  });
});
