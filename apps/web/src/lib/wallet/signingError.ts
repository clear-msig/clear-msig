export class WalletSignError extends Error {
  code:
    | "not_connected"
    | "no_sign_message"
    | "rejected"
    | "ledger_app_closed"
    | "ledger_device_locked"
    | "ledger_blind_signing_required"
    | "ledger_transport"
    | "ledger_unsupported"
    | "unknown"
    | "message_mismatch"
    | "stale_request"
    | "wallet_signed_wrong_bytes"
    | "timeout";
  /// Set when `code === "message_mismatch"` - the bytes the backend
  /// asked us to sign did not match the bytes the frontend rebuilt
  /// from chain state. Includes both for debugging.
  expectedHex?: string;
  gotHex?: string;
  constructor(
    code: WalletSignError["code"],
    message: string,
    extras?: { expectedHex?: string; gotHex?: string },
  ) {
    super(message);
    this.name = "WalletSignError";
    this.code = code;
    if (extras) {
      this.expectedHex = extras.expectedHex;
      this.gotHex = extras.gotHex;
    }
  }
}

export function ensureDescriptorFresh(descriptor: { expiry: number }) {
  const secondsLeft = descriptor.expiry - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 15) {
    throw new WalletSignError(
      "stale_request",
      "This signing request has expired or is too close to expiry. Refresh and try again.",
    );
  }
}
