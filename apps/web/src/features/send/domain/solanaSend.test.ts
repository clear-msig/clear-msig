import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatLamports,
  lamportsToSafeNumber,
  parseSolanaRecipientFromQr,
  policyCommitmentHex,
  readExecuteFailureProposal,
  tagExecuteFailure,
} from "@/features/send/domain/solanaSend";

describe("Solana send domain", () => {
  it("formats SOL without losing bigint precision", () => {
    expect(formatLamports(1_234_500_000n)).toBe("1.2345");
    expect(formatAmount("1234.56789")).toBe("1,234.56789");
  });

  it("preserves one lamport and safe-boundary fractional units in amount headlines and receipts", () => {
    expect(formatAmount("0.000000001")).toBe("0.000000001");
    expect(formatAmount("9007199.254740991")).toBe("9,007,199.254740991");
    expect(formatLamports(1n)).toBe("0.000000001");
    expect(formatLamports(9007199254740991n - 5000n)).toBe("9007199.254735991");
  });

  it("extracts a recipient from Solana payment QR data", () => {
    const address = "11111111111111111111111111111111";
    expect(parseSolanaRecipientFromQr(`solana:${address}?amount=1`)).toBe(
      address,
    );
    expect(parseSolanaRecipientFromQr(address)).toBe(address);
  });

  it("builds deterministic policy commitments", () => {
    expect(policyCommitmentHex(["wallet", "recipient", "10"])).toBe(
      policyCommitmentHex(["wallet", "recipient", "10"]),
    );
    expect(policyCommitmentHex(["wallet", "recipient", "10"])).not.toBe(
      policyCommitmentHex(["wallet", "recipient", "11"]),
    );
  });

  it("preserves a proposal reference on post-proposal execution errors", () => {
    const error = new Error("execution failed");
    tagExecuteFailure(error, "proposal-1");
    expect(readExecuteFailureProposal(error)).toBe("proposal-1");
  });

  it("rejects values that cannot be represented safely by browser numbers", () => {
    expect(lamportsToSafeNumber(42n)).toBe(42);
    expect(() =>
      lamportsToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ).toThrow("too large");
  });
});
