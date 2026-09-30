import { describe, expect, it, vi } from "vitest";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import bs58 from "bs58";
import { listProposalsForWallet } from "../proposals";
import { CLEAR_WALLET_PROGRAM_ID } from "../client";
import { findIntentAddress, findProposalAddress, findTypedProposalAddress } from "@/lib/msig";

const wallet = new PublicKey(new Uint8Array(32).fill(7));
const otherWallet = new PublicKey(new Uint8Array(32).fill(8));
const u64 = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return [...bytes];
};
function proposal(intentIndex: number, index: bigint, typed = false, ownerWallet = wallet) {
  const [intent] = findIntentAddress(ownerWallet, intentIndex, CLEAR_WALLET_PROGRAM_ID);
  const [pubkey] = (typed ? findTypedProposalAddress : findProposalAddress)(intent, index, CLEAR_WALLET_PROGRAM_ID);
  const data = Buffer.from([
    typed ? 6 : 3, ...ownerWallet.toBytes(), ...intent.toBytes(), ...u64(index),
    ...ownerWallet.toBytes(), 0,
    ...(typed ? [1] : []), ...u64(100n), ...u64(0n), ...(typed ? u64(1000n) : []),
    255, 0, 0, 0, 0, ...ownerWallet.toBytes(),
    ...(typed ? [...new Uint8Array(96), ...new Uint8Array(8)] : [...new Uint8Array(4)]),
  ]);
  const account: AccountInfo<Buffer> = { data, owner: CLEAR_WALLET_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 };
  return { pubkey, account };
}
function mockConnection(legacy: ReturnType<typeof proposal>[], typed: ReturnType<typeof proposal>[] = []) {
  const getProgramAccounts = vi.fn().mockResolvedValueOnce(legacy).mockResolvedValueOnce(typed);
  const getMultipleAccountsInfo = vi.fn();
  return { connection: { getProgramAccounts, getMultipleAccountsInfo } as unknown as Connection, getProgramAccounts, getMultipleAccountsInfo };
}

describe("wallet proposal listing", () => {
  it("uses two wallet-scoped reads for sparse histories even at u64-scale counters", async () => {
    const legacy = proposal(1, 3n);
    const typed = proposal(2, 0xffffffffffffffen, true);
    const { connection, getProgramAccounts, getMultipleAccountsInfo } = mockConnection([legacy], [typed]);
    const rows = await listProposalsForWallet(connection, wallet, { intentIndex: 2, proposalIndex: 0xffffffffffffffffn });
    expect(rows.map((row) => row.pda.toBase58())).toEqual([legacy.pubkey.toBase58(), typed.pubkey.toBase58()]);
    expect(getProgramAccounts).toHaveBeenCalledTimes(2);
    for (const [index, discriminator] of [3, 6].entries()) {
      expect(getProgramAccounts).toHaveBeenNthCalledWith(index + 1, CLEAR_WALLET_PROGRAM_ID, {
        commitment: "confirmed", filters: [
          { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.of(discriminator)) } },
          { memcmp: { offset: 1, bytes: wallet.toBase58() } },
        ],
      });
    }
    expect(getMultipleAccountsInfo).not.toHaveBeenCalled();
  });

  it("preserves intent/index/legacy-before-typed ordering regardless of RPC order", async () => {
    const { connection } = mockConnection([proposal(2, 1n), proposal(1, 5n), proposal(1, 2n)], [proposal(1, 2n, true)]);
    const rows = await listProposalsForWallet(connection, wallet, { intentIndex: 2, proposalIndex: 6n });
    expect(rows.map((row) => [row.intentIndex, row.proposalIndex, row.account.typed])).toEqual([
      [1, 2n, false], [1, 2n, true], [1, 5n, false], [2, 1n, false],
    ]);
  });

  it("rejects malformed, foreign, forged, duplicate and newer-than-snapshot accounts", async () => {
    const good = proposal(1, 1n);
    const wrongOwner = proposal(1, 2n);
    wrongOwner.account.owner = otherWallet;
    const forgedPda = proposal(1, 3n);
    forgedPda.pubkey = otherWallet;
    const malformed = proposal(1, 4n);
    malformed.account.data = Buffer.from([3, 1]);
    const { connection } = mockConnection([
      wrongOwner, forgedPda, malformed, good, good,
      proposal(1, 5n, false, otherWallet), proposal(3, 6n), proposal(1, 10n),
    ]);
    const rows = await listProposalsForWallet(connection, wallet, { intentIndex: 2, proposalIndex: 10n });
    expect(rows.map((row) => row.pda.toBase58())).toEqual([good.pubkey.toBase58()]);
  });

  it("does not query a wallet with no proposals", async () => {
    const { connection, getProgramAccounts } = mockConnection([]);
    expect(await listProposalsForWallet(connection, wallet, { intentIndex: 3, proposalIndex: 0n })).toEqual([]);
    expect(getProgramAccounts).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors rather than claiming an empty history", async () => {
    const error = new Error("RPC unavailable");
    const connection = { getProgramAccounts: vi.fn().mockRejectedValue(error) } as unknown as Connection;
    await expect(listProposalsForWallet(connection, wallet, { intentIndex: 3, proposalIndex: 1n })).rejects.toBe(error);
  });

  it.each([-1, 256, 1.5, NaN])("rejects invalid intent counters (%s)", async (intentIndex) => {
    const { connection, getProgramAccounts } = mockConnection([]);
    await expect(listProposalsForWallet(connection, wallet, { intentIndex, proposalIndex: 1n })).rejects.toThrow("Invalid wallet proposal counters");
    expect(getProgramAccounts).not.toHaveBeenCalled();
  });
});

describe("proposal counter bounds", () => {
  it.each([-1n, 0x1_0000_0000_0000_0000n])("rejects invalid u64 counter %s", async (proposalIndex) => {
    const { connection, getProgramAccounts } = mockConnection([]);
    await expect(listProposalsForWallet(connection, wallet, { intentIndex: 3, proposalIndex })).rejects.toThrow("Invalid wallet proposal counters");
    expect(getProgramAccounts).not.toHaveBeenCalled();
  });
});
