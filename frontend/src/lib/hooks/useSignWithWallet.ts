"use client";

// Single entry point for "ask the browser wallet to sign these bytes".
//
// Every signed-write route (`intent add`, `proposal create`, `approve`,
// `cancel`, `intent remove`, `intent update`) consumes the output of
// this hook verbatim . `{signer_pubkey, signature}` goes straight into
// the backend's PreSigned payload. Centralising the call in one hook
// keeps the sign path testable, makes "wallet doesn't support
// signMessage" errors consistent, and gives us a single place to add
// analytics / telemetry later.

import { useWallet, useConnection } from "@/lib/wallet";
import { useCallback } from "react";
import nacl from "tweetnacl";
import {
  toHex,
  rebuildAndVerifyMessage,
  MessageVerificationError,
} from "@/lib/msig";
import { LedgerError } from "@/lib/wallet/ledger";
import type { DryRunDescriptor } from "@/lib/api/types";

export interface SignedPayload {
  /// Base58 pubkey of the wallet that signed, ready to drop into the
  /// backend's `signer_pubkey` field.
  signer_pubkey: string;
  /// Hex-encoded 64-byte ed25519 signature.
  signature: string;
}

export class WalletSignError extends Error {
  code:
    | "not_connected"
    | "no_sign_message"
    | "rejected"
    | "ledger_app_closed"
    | "ledger_transport"
    | "ledger_unsupported"
    | "unknown"
    | "message_mismatch"
    | "wallet_signed_wrong_bytes"
    | "phantom_unsupported";
  /// Set when `code === "message_mismatch"` — the bytes the backend
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

/// Returns a stable `signBytes(messageBytes)` callback that resolves
/// with `{signer_pubkey, signature}` or throws a typed `WalletSignError`.
///
/// Also returns `signDescriptor(descriptor)` which is the preferred
/// entry point for any signed write: it rebuilds the signable bytes
/// locally from on-chain state and verifies them against
/// `descriptor.message_hex` before invoking the wallet. See
/// `rebuildAndVerifyMessage` and SECURITY.md surface A.
export function useSignWithWallet() {
  const { signMessage, publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const signBytes = useCallback(
    async (messageBytes: Uint8Array): Promise<SignedPayload> => {
      if (!connected || !publicKey) {
        throw new WalletSignError(
          "not_connected",
          "Connect a wallet before signing"
        );
      }
      if (!signMessage) {
        throw new WalletSignError(
          "no_sign_message",
          "This wallet does not support signMessage. Try Solflare, Backpack, or a Ledger."
        );
      }
      let sig: Uint8Array;
      try {
        sig = await signMessage(messageBytes);
      } catch (err) {
        // Distinguish real user rejections from device/transport
        // errors. Treating everything as "rejected" was telling
        // users they cancelled when their Ledger had closed the
        // Solana app or the cable came loose.
        throw classifySignError(err);
      }
      // Local ed25519 verify. Some embedded-wallet implementations
      // (notably Dynamic's WaaS-SVM signer) UTF-8-decode the input
      // bytes before signing, so the signature ends up over a
      // different byte sequence than what we asked for. Catching
      // that here means the user gets a clean error in the browser
      // instead of a 502 from the CLI's verifier.
      if (
        !nacl.sign.detached.verify(messageBytes, sig, publicKey.toBytes())
      ) {
        throw new WalletSignError(
          "wallet_signed_wrong_bytes",
          "Your wallet signed something different from what we asked. " +
            "This is a known issue with some embedded-wallet providers. " +
            "Sign in with Solflare, Backpack, or a Ledger to work around it.",
        );
      }
      if (sig.length !== 64) {
        throw new WalletSignError(
          "unknown",
          `Wallet returned an unexpected signature length (${sig.length}, want 64)`
        );
      }
      return {
        signer_pubkey: publicKey.toBase58(),
        signature: toHex(sig),
      };
    },
    [connected, publicKey, signMessage]
  );

  /// Rebuild the signable bytes from chain state, verify they match
  /// the backend-supplied `message_hex`, then ask the wallet to sign
  /// the locally-rebuilt bytes. Throws `WalletSignError` with code
  /// `"message_mismatch"` if the backend tried to swap them.
  const signDescriptor = useCallback(
    async (descriptor: DryRunDescriptor): Promise<SignedPayload> => {
      let bytes: Uint8Array;
      try {
        bytes = await rebuildAndVerifyMessage(descriptor, connection);
      } catch (err) {
        if (err instanceof MessageVerificationError) {
          throw new WalletSignError(
            "message_mismatch",
            err.message,
            { expectedHex: err.expected, gotHex: err.got },
          );
        }
        throw err;
      }
      return signBytes(bytes);
    },
    [connection, signBytes],
  );

  return {
    signBytes,
    signDescriptor,
    canSign: Boolean(connected && publicKey && signMessage),
  };
}

/// Translate any throwable from the underlying wallet/device into a
/// typed `WalletSignError`. Real user rejections get `rejected`; the
/// device-state cases (Ledger Solana app closed, cable lost) keep
/// their own codes so `friendlyError` can show "open the Solana app"
/// instead of "you cancelled".
function classifySignError(err: unknown): WalletSignError {
  if (err instanceof LedgerError) {
    switch (err.code) {
      case "rejected":
        return new WalletSignError("rejected", err.message);
      case "app_closed":
        return new WalletSignError("ledger_app_closed", err.message);
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
    // Phantom's tx-detection heuristic refuses our offchain envelope
    // (the spec'd `\xff` magic byte trips it as a versioned-tx prefix).
    // Surface a typed code so the UI can show "swap to Solflare/Ledger"
    // copy instead of the raw Phantom error.
    if (m.includes("cannot sign solana transactions using sign message")) {
      return new WalletSignError("phantom_unsupported", err.message);
    }
    return new WalletSignError("unknown", err.message);
  }
  return new WalletSignError("unknown", "Wallet returned an unknown error");
}
