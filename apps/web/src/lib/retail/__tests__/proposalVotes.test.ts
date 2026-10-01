import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { proposalVoterState, unvotedMembers } from "../proposalVotes";
const ledger = new PublicKey(new Uint8Array(32).fill(1));
const embedded = new PublicKey(new Uint8Array(32).fill(2));
const other = new PublicKey(new Uint8Array(32).fill(3));
const members = [ledger.toBase58(), embedded.toBase58(), other.toBase58()];
const pick = (allowed: readonly string[]) =>
  [ledger, embedded].find((key) => allowed.includes(key.toBase58())) ?? null;
describe("proposal member vote selection", () => {
  it("uses an eligible secondary wallet when the default wallet is unrelated", () => {
    expect(proposalVoterState([embedded.toBase58()], 0, 0, pick).approver).toBe(
      embedded,
    );
  });
  it("skips an already-approved preferred wallet and selects another eligible member", () => {
    const state = proposalVoterState(members, 1, 0, pick);
    expect(state.approver).toBe(embedded);
    expect(state.canceller).toBe(ledger);
  });
  it("skips cancellation votes independently and allows an opposite vote replacement", () => {
    const state = proposalVoterState(members, 2, 1, pick);
    expect(state.approver).toBe(ledger);
    expect(state.canceller).toBe(embedded);
  });
  it("does not offer a repeat vote when all connected members already voted", () => {
    const state = proposalVoterState(members, 3, 0, pick);
    expect(state.member).toBe(ledger);
    expect(state.approver).toBeNull();
    expect(proposalVoterState(members, 0, 3, pick).canceller).toBeNull();
  });
  it("does not offer either vote for a read-only viewer", () => {
    expect(proposalVoterState([other.toBase58()], 0, 0, pick)).toEqual({
      member: null,
      approver: null,
      canceller: null,
    });
  });
  it("preserves original bitmap indices when excluding voted members", () => {
    expect(unvotedMembers(members, 5)).toEqual([embedded.toBase58()]);
    expect(
      unvotedMembers(
        Array.from({ length: 16 }, (_, i) => String(i)),
        32768,
      ),
    ).not.toContain("15");
  });
});
