export type LedgerErrorCode =
  | "unsupported"
  | "no_device"
  | "app_closed"
  | "device_locked"
  | "blind_signing_required"
  | "rejected"
  | "transport_lost"
  | "unknown";

export class LedgerError extends Error {
  code: LedgerErrorCode;
  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
