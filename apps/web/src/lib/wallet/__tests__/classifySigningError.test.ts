import { describe, expect, it } from "vitest";
import { LedgerError } from "../ledger";
import { classifySignError } from "../classifySigningError";
import { WalletSignError } from "../signingError";

describe("deferred device error classification", () => {
  it("recognizes the error identity exported by the actual Ledger adapter", () => {
    const error = classifySignError(new LedgerError("app_closed", "Open the Solana app"));
    expect(error).toBeInstanceOf(WalletSignError);
    expect(error.code).toBe("ledger_app_closed");
    expect(error.message).toBe("Open the Solana app");
  });
  it("keeps provider rejection distinct from device/transport failure", () => {
    expect(classifySignError(new Error("User rejected the request")).code).toBe("rejected");
    expect(classifySignError(new LedgerError("transport_lost", "Disconnected")).code).toBe("ledger_transport");
  });
});
