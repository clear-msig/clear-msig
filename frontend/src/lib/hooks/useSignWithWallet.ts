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

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback } from "react";
import { toHex } from "@/lib/msig";

export interface SignedPayload {
  /// Base58 pubkey of the wallet that signed, ready to drop into the
  /// backend's `signer_pubkey` field.
  signer_pubkey: string;
  /// Hex-encoded 64-byte ed25519 signature.
  signature: string;
}

export class WalletSignError extends Error {
  code: "not_connected" | "no_sign_message" | "rejected" | "unknown";
  constructor(code: WalletSignError["code"], message: string) {
    super(message);
    this.name = "WalletSignError";
    this.code = code;
  }
}

/// Returns a stable `signBytes(messageBytes)` callback that resolves
/// with `{signer_pubkey, signature}` or throws a typed `WalletSignError`.
export function useSignWithWallet() {
  const { signMessage, publicKey, connected } = useWallet();

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

  return { signBytes, canSign: Boolean(connected && publicKey && signMessage) };
}
