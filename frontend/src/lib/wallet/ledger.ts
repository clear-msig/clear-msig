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

// Ledger SDK is heavy and only used by the small minority of users
// who own a hardware wallet. Defer the imports until connectLedger()
// actually fires so the cold start of every other surface doesn't
// pay for it. See lib/wallet/LedgerProvider.tsx for the call site;
// the provider mounts on every /app/* route via AppProviders.
import bs58 from "bs58";

type SolanaSdk = typeof import("@ledgerhq/hw-app-solana").default;
type TransportWebHIDSdk =
  typeof import("@ledgerhq/hw-transport-webhid").default;

let ledgerSdkPromise:
  | Promise<{ Solana: SolanaSdk; TransportWebHID: TransportWebHIDSdk }>
  | null = null;

function loadLedgerSdk() {
  if (!ledgerSdkPromise) {
    ledgerSdkPromise = Promise.all([
      import("@ledgerhq/hw-app-solana"),
      import("@ledgerhq/hw-transport-webhid"),
    ]).then(([solanaMod, transportMod]) => ({
      Solana: solanaMod.default,
      TransportWebHID: transportMod.default,
    }));
  }
  return ledgerSdkPromise;
}

/// BIP44 path for the first Solana account on a Ledger. Matches the
/// upstream CLI's default (`--ledger-account 0`). Power users with
/// multiple accounts on the same device can override the index via
/// the Settings page; see getLedgerAccountIndex() below.
const DEFAULT_DERIVATION_PATH = "44'/501'/0'";

/// localStorage key for the saved Ledger account index. Read at
/// connect time so the next session uses the user's selection
/// without restart.
export const LEDGER_ACCOUNT_STORAGE_KEY = "clear.ledger-account.v1";

/// Read the saved Ledger account index (0..9). Defaults to 0 when
/// missing, malformed, or out of range. Bounded so a corrupted
/// localStorage entry can't drive `derivationPath` somewhere weird.
export function getLedgerAccountIndex(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LEDGER_ACCOUNT_STORAGE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 9) return 0;
    return n;
  } catch {
    return 0;
  }
}

/// Persist a Ledger account index. Caller is responsible for
/// re-connecting (or telling the user to) so the new derivation
/// path is used.
export function setLedgerAccountIndex(index: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(index) || index < 0 || index > 9) return;
  try {
    window.localStorage.setItem(
      LEDGER_ACCOUNT_STORAGE_KEY,
      String(Math.floor(index)),
    );
  } catch {
    /* localStorage full or blocked - silently noop */
  }
}

/// Build the BIP44 path for a given account index. Useful for
/// showing the user which path their current session is using.
export function ledgerDerivationPath(accountIndex: number): string {
  return `44'/501'/${Math.floor(accountIndex)}'`;
}

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

export interface LedgerSession {
  /// Raw 32-byte ed25519 pubkey from the device.
  pubkey: Uint8Array;
  /// Base58 form, matches the rest of the app's pubkey type.
  pubkeyBase58: string;
  /// BIP44 derivation path used for this session (mostly for display).
  derivationPath: string;
  /// Solana app version reported by the device. Null means capability
  /// discovery failed, which deliberately keeps ClearSign on the full profile.
  appVersion: string | null;
  /// Sign an offchain-wrapped message. Returns 64-byte ed25519 sig.
  /// Pass the OUTPUT of `wrapOffchain(body)` here, not the raw body -
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
  derivationPath?: string,
): Promise<LedgerSession> {
  const path =
    derivationPath ??
    (typeof window === "undefined"
      ? DEFAULT_DERIVATION_PATH
      : ledgerDerivationPath(getLedgerAccountIndex()));
  if (typeof navigator === "undefined" || !("hid" in navigator)) {
    throw new LedgerError(
      "unsupported",
      "Your browser does not support hardware wallets over WebHID. Try Chrome, Edge, or Brave.",
    );
  }

  const { Solana, TransportWebHID } = await loadLedgerSdk();

  let transport: Awaited<ReturnType<typeof TransportWebHID.create>>;
  try {
    transport = await TransportWebHID.create();
  } catch (err) {
    throw mapTransportError(err);
  }

  const solana = new Solana(transport);
  let appVersion: string | null = null;
  try {
    const configuration = await solana.getAppConfiguration();
    appVersion = configuration.version;
  } catch {
    // Address/signing support can still work on older SDK/app combinations.
    // Unknown capability must never opt the signer into a compact profile.
  }

  let pubkey: Uint8Array;
  try {
    const result = await solana.getAddress(path);
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
    derivationPath: path,
    appVersion,
    async signOffchainMessage(bytes: Uint8Array) {
      try {
        const result = await solana.signOffchainMessage(
          path,
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

// Status-code reference: APDU response codes the Solana app on Ledger
// returns. Documented in Ledger's @ledgerhq/errors and the
// upstream solana-app source. Mapping notes:
//
//   0x6982  Security status not satisfied. Device is locked. The user
//           sees a black screen and we want to send them to "unlock the
//           device and try again", not a vague error.
//   0x6985  Conditions of use not satisfied. User pressed Reject.
//   0x6808  BLIND_SIGNATURE_REQUIRED. Message format the device won't
//           render in clear-sign mode. Show the user how to enable
//           blind signing instead of throwing them under the bus.
//   0x6d00  / 0x6d02 / 0x6e00  Wrong app open / app not running /
//           ins not supported by current app.
const LEDGER_STATUS = {
  DEVICE_LOCKED: 0x6982,
  REJECTED: 0x6985,
  BLIND_SIGNING_REQUIRED: 0x6808,
  APP_NOT_OPEN_A: 0x6d00,
  APP_NOT_OPEN_B: 0x6d02,
  APP_NOT_OPEN_C: 0x6e00,
} as const;

function mapAppError(err: unknown): LedgerError {
  const e = (err ?? {}) as RawHidError;
  const message = (e.message ?? "").toLowerCase();
  if (
    e.statusCode === LEDGER_STATUS.DEVICE_LOCKED ||
    message.includes("security status not satisfied") ||
    message.includes("device is locked")
  ) {
    return new LedgerError(
      "device_locked",
      "Unlock your Ledger (PIN screen), then try again.",
    );
  }
  // Ledger device returns the 0x6d / 0x6e family when the app expected
  // by the SDK is not the one currently open.
  if (
    e.statusCode === LEDGER_STATUS.APP_NOT_OPEN_A ||
    e.statusCode === LEDGER_STATUS.APP_NOT_OPEN_B ||
    e.statusCode === LEDGER_STATUS.APP_NOT_OPEN_C ||
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
  if (
    e.statusCode === LEDGER_STATUS.REJECTED ||
    message.includes("denied by the user") ||
    message.includes("rejected")
  ) {
    return new LedgerError(
      "rejected",
      "You declined the message on the Ledger. Tap Approve on the device to sign.",
    );
  }
  if (
    e.statusCode === LEDGER_STATUS.DEVICE_LOCKED ||
    message.includes("security status not satisfied") ||
    message.includes("device is locked")
  ) {
    return new LedgerError(
      "device_locked",
      "Your Ledger went to sleep. Unlock it (enter your PIN), reopen the Solana app, and try again.",
    );
  }
  if (
    e.statusCode === LEDGER_STATUS.BLIND_SIGNING_REQUIRED ||
    message.includes("blind signing") ||
    message.includes("blind sign")
  ) {
    return new LedgerError(
      "blind_signing_required",
      "Your Ledger needs Blind Signing enabled for this kind of message. Open the Solana app on the device → Settings → Blind Signing → Enabled, then try again.",
    );
  }
  if (message.includes("transport") || message.includes("disconnected")) {
    return new LedgerError(
      "transport_lost",
      "Lost the connection to the Ledger. Reconnect the cable and try again.",
    );
  }
  if (
    e.statusCode === LEDGER_STATUS.APP_NOT_OPEN_A ||
    e.statusCode === LEDGER_STATUS.APP_NOT_OPEN_C ||
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
