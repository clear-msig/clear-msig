import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  findProposalAddress,
  findTypedProposalAddress,
} from "@/lib/msig/pda";

function key(byte: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(byte));
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, value, true);
  return out;
}

describe("proposal PDA derivation", () => {
  it("keeps legacy and typed proposal namespaces separate", () => {
    const intent = key(7);
    const programId = key(9);
    const index = 42n;
    const [legacy] = findProposalAddress(intent, index, programId);
    const [typed] = findTypedProposalAddress(intent, index, programId);

    expect(typed.toBase58()).not.toBe(legacy.toBase58());
    expect(legacy.toBase58()).toBe(
      PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("proposal"), intent.toBytes(), u64(index)],
        programId,
      )[0].toBase58(),
    );
    expect(typed.toBase58()).toBe(
      PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("typed_proposal"), intent.toBytes(), u64(index)],
        programId,
      )[0].toBase58(),
    );
  });
});
