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
import {
  toHex,
  rebuildAndVerifyMessage,
  MessageVerificationError,
} from "@/lib/msig";
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
    | "unknown"
    | "message_mismatch";
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
          "This wallet does not support signMessage. Try Phantom, Solflare, or Backpack."
        );
      }
      let sig: Uint8Array;
      try {
        sig = await signMessage(messageBytes);
      } catch (err) {
        // Phantom / Solflare surface "User rejected" strings; treat
        // anything thrown from the wallet as a user-visible rejection.
        const message =
          err instanceof Error ? err.message : "Wallet rejected the signature";
        throw new WalletSignError("rejected", message);
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
