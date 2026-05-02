// Ledger Solana signer over WebHID.
//
// This is the path that earns the "clear signing" claim: when the
// host hands the device a Solana offchain-wrapped message (the same
// bytes `wrapOffchain` produces), the Ledger Solana app detects the
// `\xffsolana offchain` prefix + format-byte 0 (restricted ASCII),
// renders the body as plain text on the device screen, and asks the
// user to confirm. There is no hex layer between the user and the
// signed bytes.
//
// We use `@ledgerhq/hw-app-solana::signOffchainMessage` to drive that
// flow. `wrapOffchain` already produces the exact buffer shape it
// expects, so the bytes we hand over are byte-for-byte identical to
// what the on-chain program will rebuild during verify.

import Solana from "@ledgerhq/hw-app-solana";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import bs58 from "bs58";

/// BIP44 path for the first Solana account on a Ledger. Matches the
/// upstream CLI's default (`--ledger-account 0`). Future work: let
/// users pick account index from settings.
const DEFAULT_DERIVATION_PATH = "44'/501'/0'";

export type LedgerErrorCode =
  | "unsupported"
  | "no_device"
  | "app_closed"
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

export interface LedgerSession {
  /// Raw 32-byte ed25519 pubkey from the device.
  pubkey: Uint8Array;
  /// Base58 form, matches the rest of the app's pubkey type.
  pubkeyBase58: string;
  /// BIP44 derivation path used for this session (mostly for display).
  derivationPath: string;
  /// Sign an offchain-wrapped message. Returns 64-byte ed25519 sig.
  /// Pass the OUTPUT of `wrapOffchain(body)` here, not the raw body —
  /// the Solana app insists on the offchain envelope and uses it to
  /// decide what to render on the device screen.
  signOffchainMessage(bytes: Uint8Array): Promise<Uint8Array>;
  /// Tear down the WebHID transport. Idempotent.
  disconnect(): Promise<void>;
}

interface RawHidError {
  message?: string;
  name?: string;
  statusCode?: number;
  statusText?: string;
}

/// Open a WebHID transport, ask the device for the first Solana
/// pubkey, and return a session object the rest of the app can use
/// like a software wallet. Throws a `LedgerError` with a friendly
/// `code` so the UI can render the right next-step copy.
export async function connectLedger(
  derivationPath: string = DEFAULT_DERIVATION_PATH,
): Promise<LedgerSession> {
  if (typeof navigator === "undefined" || !("hid" in navigator)) {
    throw new LedgerError(
      "unsupported",
      "Your browser does not support hardware wallets over WebHID. Try Chrome, Edge, or Brave.",
    );
  }

  let transport: Awaited<ReturnType<typeof TransportWebHID.create>>;
  try {
    transport = await TransportWebHID.create();
  } catch (err) {
    throw mapTransportError(err);
  }

  const solana = new Solana(transport);

  let pubkey: Uint8Array;
  try {
    const result = await solana.getAddress(derivationPath);
    pubkey = new Uint8Array(result.address);
    if (pubkey.length !== 32) {
      throw new LedgerError(
        "unknown",
        `Ledger returned an unexpected pubkey length (${pubkey.length}, want 32)`,
      );
    }
  } catch (err) {
    await safeClose(transport);
    if (err instanceof LedgerError) throw err;
    throw mapAppError(err);
  }

  return {
    pubkey,
    pubkeyBase58: bs58.encode(pubkey),
    derivationPath,
    async signOffchainMessage(bytes: Uint8Array) {
      try {
        const result = await solana.signOffchainMessage(
          derivationPath,
          // Buffer.from copies; we don't want to alias the caller's
          // memory and risk it being mutated mid-roundtrip.
          Buffer.from(bytes),
        );
        const sig = new Uint8Array(result.signature);
        if (sig.length !== 64) {
          throw new LedgerError(
            "unknown",
            `Ledger returned an unexpected signature length (${sig.length}, want 64)`,
          );
        }
        return sig;
      } catch (err) {
        if (err instanceof LedgerError) throw err;
        throw mapSignError(err);
      }
    },
    async disconnect() {
      await safeClose(transport);
    },
  };
}

async function safeClose(transport: { close: () => Promise<void> }) {
  try {
    await transport.close();
  } catch {
    /* already closed */
  }
}

function mapTransportError(err: unknown): LedgerError {
  const e = (err ?? {}) as RawHidError;
  const message = (e.message ?? "").toLowerCase();
  if (message.includes("no device") || e.name === "NotFoundError") {
    return new LedgerError(
      "no_device",
      "No Ledger detected. Connect the device with a USB cable and unlock it before trying again.",
    );
  }
  if (message.includes("permission") || e.name === "NotAllowedError") {
    return new LedgerError(
      "no_device",
      "Permission to talk to the Ledger was denied. Click Connect again and approve the device picker.",
    );
  }
  return new LedgerError(
    "no_device",
    "Could not reach the Ledger. Check the cable, unlock the device, and try again.",
  );
}

function mapAppError(err: unknown): LedgerError {
  const e = (err ?? {}) as RawHidError;
  const message = (e.message ?? "").toLowerCase();
  // Ledger device returns 0x6d00 / 0x6d02 / 0x6e00 family when the app
  // expected by the SDK is not the one currently open.
  if (
    e.statusCode === 0x6d00 ||
    e.statusCode === 0x6d02 ||
    e.statusCode === 0x6e00 ||
    message.includes("incorrect length") ||
    message.includes("app is not open") ||
    message.includes("ins not supported")
  ) {
    return new LedgerError(
      "app_closed",
      "Open the Solana app on your Ledger and unlock the device, then try again.",
    );
  }
  return new LedgerError(
    "unknown",
    `Ledger refused: ${e.message ?? "unknown reason"}`,
  );
}

function mapSignError(err: unknown): LedgerError {
  const e = (err ?? {}) as RawHidError;
  const message = (e.message ?? "").toLowerCase();
  if (e.statusCode === 0x6985 || message.includes("denied by the user") || message.includes("rejected")) {
    return new LedgerError(
      "rejected",
      "You declined the message on the Ledger. Tap Approve on the device to sign.",
    );
  }
  if (message.includes("transport") || message.includes("disconnected")) {
    return new LedgerError(
      "transport_lost",
      "Lost the connection to the Ledger. Reconnect the cable and try again.",
    );
  }
  if (
    e.statusCode === 0x6d00 ||
    e.statusCode === 0x6e00 ||
    message.includes("app is not open")
  ) {
    return new LedgerError(
      "app_closed",
      "The Solana app on your Ledger closed. Open it and try again.",
    );
  }
  return new LedgerError(
    "unknown",
    `Ledger signing failed: ${e.message ?? "unknown reason"}`,
  );
}
