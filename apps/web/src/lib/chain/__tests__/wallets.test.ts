import { describe, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchWalletByName, fetchWalletByPda } from "../wallets";
import { CLEAR_WALLET_PROGRAM_ID } from "../client";
import { findWalletAddress } from "@/lib/msig";
function fixture(name: string, byte: number) {
  const creator = new PublicKey(new Uint8Array(32).fill(byte));
  const [pubkey, bump] = findWalletAddress(name, creator, CLEAR_WALLET_PROGRAM_ID);
  const text = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32LE(text.length);
  return { pubkey, account: { owner: CLEAR_WALLET_PROGRAM_ID, data: Buffer.concat([Buffer.from([1, bump]), Buffer.alloc(8), Buffer.from([2]), creator.toBuffer(), length, text]) } };
}
describe("canonical wallet lookup", () => {
  it("resolves the single valid creator-scoped wallet", async () => {
    const row = fixture("team", 7);
    const connection = { getProgramAccounts: vi.fn().mockResolvedValue([row]) } as unknown as Connection;
    expect((await fetchWalletByName(connection, "team"))?.pda).toEqual(row.pubkey);
  });
  it("refuses name collisions instead of RPC-order selection", async () => {
    const rows = [fixture("team", 7), fixture("team", 8)];
    const connection = { getProgramAccounts: vi.fn().mockResolvedValue(rows) } as unknown as Connection;
    await expect(fetchWalletByName(connection, "team")).rejects.toThrow("ambiguous");
  });
  it("ignores foreign owners and forged PDAs", async () => {
    const foreign = fixture("team", 7); foreign.account.owner = new PublicKey(new Uint8Array(32).fill(9));
    const forged = fixture("team", 8); forged.pubkey = foreign.account.owner;
    const connection = { getProgramAccounts: vi.fn().mockResolvedValue([foreign, forged]) } as unknown as Connection;
    expect(await fetchWalletByName(connection, "team")).toBeNull();
  });
  it("rejects a foreign-owned account on direct reads", async () => {
    const row = fixture("team", 7); row.account.owner = new PublicKey(new Uint8Array(32).fill(9));
    const connection = { getAccountInfo: vi.fn().mockResolvedValue(row.account) } as unknown as Connection;
    await expect(fetchWalletByPda(connection, row.pubkey)).rejects.toThrow("owner");
  });
});
