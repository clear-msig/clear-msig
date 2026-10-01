import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { fetchRecurringSchedule } from "./recurringState";
import {
  readRecurringJournal,
  writeRecurringJournal,
} from "./recurringJournal";
import type { ProSchedule } from "@/lib/pro/treasury";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture() {
  const wallet = new PublicKey(new Uint8Array(32).fill(7));
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("schedule")),
  );
  const [, bump] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("recurring"), wallet.toBytes(), hash],
    CLEAR_WALLET_PROGRAM_ID,
  );
  const data = Buffer.alloc(833);
  data[0] = 12;
  data.set(wallet.toBytes(), 1);
  data.set(hash, 65);
  data[831] = 1;
  data[832] = bump;
  const account = { data, owner: CLEAR_WALLET_PROGRAM_ID, executable: false };
  const rpc = {
    getGenesisHash: vi.fn(async () => "pinned"),
    getAccountInfo: vi.fn(async () => account),
  };
  vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "pinned");
  return {
    wallet,
    data,
    account,
    rpc,
    connection: rpc as unknown as Connection,
  };
}
describe("finalized recurring schedule evidence", () => {
  it("reads the derived owned schedule at finalized commitment", async () => {
    const f = await fixture();
    expect(
      (await fetchRecurringSchedule(f.connection, f.wallet, "schedule"))
        ?.status,
    ).toBe("active");
    expect(f.rpc.getAccountInfo).toHaveBeenCalledWith(
      expect.any(PublicKey),
      "finalized",
    );
  });
  it.each(["wallet", "hash", "bump", "owner", "executable"])(
    "rejects changed %s identity",
    async (field) => {
      const f = await fixture();
      if (field === "wallet") f.data[1] ^= 1;
      if (field === "hash") f.data[65] ^= 1;
      if (field === "bump") f.data[832] ^= 1;
      if (field === "owner") f.account.owner = f.wallet;
      if (field === "executable") f.account.executable = true;
      await expect(
        fetchRecurringSchedule(f.connection, f.wallet, "schedule"),
      ).rejects.toThrow("identity mismatch");
    },
  );
  it("fails closed before account reads without pinned genesis", async () => {
    const f = await fixture();
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "");
    await expect(
      fetchRecurringSchedule(f.connection, f.wallet, "schedule"),
    ).rejects.toThrow("pinned");
    expect(f.rpc.getAccountInfo).not.toHaveBeenCalled();
  });
  it("rejects an unrecognized status rather than treating it as complete", async () => {
    const f = await fixture();
    f.data[831] = 99;
    await expect(
      fetchRecurringSchedule(f.connection, f.wallet, "schedule"),
    ).rejects.toThrow("unsupported");
  });
});
describe("durable recurring request journal", () => {
  it("preserves unknown request evidence across reload and refuses corrupt storage", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const row = {
      id: "saved",
      pendingExecution: { phase: "attempted" },
    } as ProSchedule;
    writeRecurringJournal("wallet", "rpc", row);
    expect(readRecurringJournal("wallet", "rpc")).toEqual([row]);
    expect(readRecurringJournal("wallet", "other-rpc")).toEqual([]);
    values.set([...values.keys()][0], "not JSON");
    expect(() => readRecurringJournal("wallet", "rpc")).toThrow();
  });
  it("fails before allowing submission when persistence cannot be verified", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: () => {} },
    });
    expect(() =>
      writeRecurringJournal("wallet", "rpc", { id: "saved" } as ProSchedule),
    ).toThrow("No submission");
  });
});
