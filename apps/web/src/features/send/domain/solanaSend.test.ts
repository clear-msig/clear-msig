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
    expect(formatAmount("1234.56789")).toBe("1,234.5679");
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
