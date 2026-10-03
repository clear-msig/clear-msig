import { LedgerError } from "./ledgerError";
import { WalletSignatureTimeoutError } from "./signing";
import { WalletSignError } from "./signingError";

/// Translate any throwable from the underlying wallet/device into a
/// typed `WalletSignError`. Real user rejections get `rejected`; the
/// device-state cases (Ledger Solana app closed, cable lost) keep
/// their own codes so `friendlyError` can show "open the Solana app"
/// instead of "you cancelled".
export function classifySignError(err: unknown): WalletSignError {
  if (err instanceof WalletSignatureTimeoutError) {
    return new WalletSignError(
      "timeout",
      "Your wallet did not open the signing request. Return to the app and try again, or reconnect the wallet.",
    );
  }
  if (err instanceof LedgerError) {
    switch (err.code) {
      case "rejected":
        return new WalletSignError("rejected", err.message);
      case "app_closed":
        return new WalletSignError("ledger_app_closed", err.message);
      case "device_locked":
        return new WalletSignError("ledger_device_locked", err.message);
      case "blind_signing_required":
        return new WalletSignError(
          "ledger_blind_signing_required",
          err.message,
        );
      case "transport_lost":
      case "no_device":
        return new WalletSignError("ledger_transport", err.message);
      case "unsupported":
        return new WalletSignError("ledger_unsupported", err.message);
      default:
        return new WalletSignError("unknown", err.message);
    }
  }
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (
      m.includes("user rejected") ||
      m.includes("user declined") ||
      m.includes("user denied") ||
      m.includes("rejected by the user") ||
      m.includes("rejected the request") ||
      m.includes("cancelled by user") ||
      m.includes("approval denied")
    ) {
      return new WalletSignError("rejected", err.message);
    }
    return new WalletSignError("unknown", err.message);
  }
  return new WalletSignError("unknown", "Wallet returned an unknown error");
}
