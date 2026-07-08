import { describe, expect, it } from "vitest";

import { friendlyError } from "@/lib/api/errors";
import { WalletSignError } from "@/lib/hooks/useSignWithWallet";

describe("friendlyError", () => {
  it("maps ClearSign envelope mismatch instead of generic Solana rejection", () => {
    const fe = friendlyError(
      new Error(
        "RPC response error -32002: Transaction simulation failed: " +
          "Error processing Instruction 1: custom program error: 0x1788",
      ),
      "send",
    );

    expect(fe.title).toBe("ClearSign details did not verify");
    expect(fe.body).toContain("Create a fresh request");
  });

  it("maps local ClearSign message mismatch before wallet signing", () => {
    const fe = friendlyError(
      new WalletSignError(
        "message_mismatch",
        "Typed ClearSign envelope hash does not match.",
      ),
      "send",
    );

    expect(fe.title).toBe("ClearSign details changed before signing");
    expect(fe.body).toContain("Nothing moved");
  });
});
