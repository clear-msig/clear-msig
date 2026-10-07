import { describe, expect, it } from "vitest";
import {
  balanceChange,
  describeDuration,
  describeExpiry,
  describeTimelock,
  formatSol,
  parseReviewFacts,
  solToLamports,
} from "../reviewFacts";

describe("parseReviewFacts", () => {
  it("reads amount, destination and network from DETAILS", () => {
    const facts = parseReviewFacts([
      {
        title: "DETAILS",
        text: "From wallet: Ops\nNetwork: Solana Devnet\nAmount: 0.3 SOL\nTo: DestAddr111",
      },
    ]);
    expect(facts).toEqual({
      amount: { value: "0.3", ticker: "SOL" },
      destination: "DestAddr111",
      network: "Solana Devnet",
    });
  });
  it("returns nulls rather than guessing for unfamiliar documents", () => {
    expect(parseReviewFacts([{ title: "DETAILS", text: "Amount: lots" }])).toEqual({
      amount: null,
      destination: null,
      network: null,
    });
  });
});

describe("SOL arithmetic is exact", () => {
  it("converts decimals without floating point", () => {
    expect(solToLamports("0.3")).toBe(300_000_000n);
    expect(solToLamports("0.000000001")).toBe(1n);
    expect(solToLamports("12")).toBe(12_000_000_000n);
  });
  it("rejects malformed or over-precise amounts", () => {
    for (const bad of ["", "-1", "1e3", "0.0000000001", "1.", ".5", "1,5"])
      expect(solToLamports(bad)).toBeNull();
  });
  it("formats lamports and computes the balance change", () => {
    expect(formatSol(12_400_000_000n)).toBe("12.4");
    expect(formatSol(1n)).toBe("0.000000001");
    const c = balanceChange(12_400_000_000n, 300_000_000n);
    expect(formatSol(c.after)).toBe("12.1");
    expect(c.insufficient).toBe(false);
    expect(balanceChange(1n, 2n).insufficient).toBe(true);
  });
});

describe("time wording", () => {
  it("describes durations plainly", () => {
    expect(describeDuration(30)).toBe("30 seconds");
    expect(describeDuration(3600)).toBe("1 hour");
    expect(describeDuration(5400)).toBe("1 hour 30 minutes");
    expect(describeDuration(172_800)).toBe("2 days");
  });
  it("marks expired and upcoming deadlines", () => {
    const now = Date.UTC(2026, 9, 7, 12, 0, 0);
    const soon = describeExpiry(BigInt(now / 1000 + 23 * 3600), now);
    expect(soon.expired).toBe(false);
    expect(soon.relative).toBe("Expires in 23 hours");
    expect(soon.absoluteUtc).toBe("2026-10-08 11:00 UTC");
    const past = describeExpiry(BigInt(now / 1000 - 7200), now);
    expect(past.expired).toBe(true);
    expect(past.relative).toBe("Expired 2 hours ago");
  });
  it("explains the timelock in terms of approvals", () => {
    expect(describeTimelock(0, 2)).toMatch(/No delay.*2 approvals are in/);
    expect(describeTimelock(3600, 1)).toMatch(/After 1 approval, it waits 1 hour/);
  });
});
