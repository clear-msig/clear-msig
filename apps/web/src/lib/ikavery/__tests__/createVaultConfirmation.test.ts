import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMultiMemberVault, createSoloVault } from "../clearmsig-actions";

const mocks = vi.hoisted(() => ({ save: vi.fn(), backup: vi.fn(), dkg: vi.fn(), register: vi.fn() }));
vi.mock("../ika-web", () => ({ ikaDkgWeb: mocks.dkg }));
vi.mock("../clearmsig-attestations", () => ({ saveAttestation: mocks.save, downloadAttestationBackup: mocks.backup }));
vi.mock("../passkey/registration", () => ({ registerPasskey: mocks.register }));
const creator = Keypair.fromSeed(new Uint8Array(32).fill(1));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.dkg.mockResolvedValue({ publicKey: new Uint8Array(32).fill(2), attestationData: new Uint8Array(8), networkSignature: new Uint8Array(64), networkPubkey: new Uint8Array(32), dwalletAddr: "test-dwallet" });
  mocks.register.mockResolvedValue({ publicKey: new Uint8Array(33).fill(2) });
});

function connection(err: unknown) {
  return {
    getAccountInfo: vi.fn().mockResolvedValue({ data: Buffer.alloc(1) }),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: creator.publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: vi.fn().mockResolvedValue("test-signature"),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err } }),
  } as unknown as Connection;
}
const signTransaction = async <T extends VersionedTransaction>(tx: T): Promise<T> => { tx.sign([creator]); return tx; };

describe("vault creation confirmation boundary", () => {
  it.each(["solo", "shared"] as const)("does not save recovery state after failed %s creation", async (kind) => {
    const options = { connection: connection({ InstructionError: [0, "InvalidArgument"] }), creator: creator.publicKey, threshold: 1, signTransaction };
    const work = kind === "solo" ? createSoloVault(options) : createMultiMemberVault({ ...options, threshold: 2, memberCount: 2 });
    await expect(work).rejects.toThrow("failed on chain");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it("saves recovery state only after successful confirmation", async () => {
    const result = await createSoloVault({ connection: connection(null), creator: creator.publicKey, threshold: 1, signTransaction });
    expect(result.txSignature).toBe("test-signature");
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.backup).toHaveBeenCalledOnce();
  });
});
