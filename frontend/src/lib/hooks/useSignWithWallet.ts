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
import { PublicKey } from "@solana/web3.js";
import {
  fromHex,
  toHex,
  rebuildAndVerifyMessage,
  MessageVerificationError,
} from "@/lib/msig";
import { messageFlavorForSigner } from "@/lib/hooks/signFlavor";
import { LedgerError } from "@/lib/wallet/ledger";
import {
  TypedClearSignMessageVerificationError,
  verifiedTypedClearSignMessageBytes,
} from "@/lib/clearsign-v2/typedMessage";
import type { DryRunDescriptor, TypedDryRunDescriptor } from "@/lib/api/types";
import type { MessageFlavor } from "@/lib/msig/offchain";

export interface SignOptions {
  /// When provided, route the sign through the signer whose pubkey
  /// matches. Used when the wallet's on-chain approver list dictates
  /// a specific signer (e.g. wallet was created with the embedded
  /// pubkey but the user has since connected a Ledger). Resolve via
  /// `useWallet().pickSigner(approvers)`.
  preferSigner?: PublicKey | null;
}

export interface SignedPayload {
  /// Base58 pubkey of the wallet that signed, ready to drop into the
  /// backend's `signer_pubkey` field.
  signer_pubkey: string;
  /// Hex-encoded 64-byte ed25519 signature.
  signature: string;
  /// Byte layout that was signed. The backend forwards this to the CLI
  /// so pre-signed verification uses the same layout instead of
  /// guessing via fallback.
  message_flavor?: "offchain_v1" | "plain_v2" | "clearsign_v2_text";
  /// Hex-encoded exact message bytes the user signed. Typed ClearSign
  /// votes submit this so the program verifies the readable text.
  signed_message_hex?: string;
}

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
    | "wallet_signed_wrong_bytes";
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

/// Returns a stable `signBytes(messageBytes)` callback that resolves
/// with `{signer_pubkey, signature}` or throws a typed `WalletSignError`.
///
/// Also returns `signDescriptor(descriptor)` which is the preferred
/// entry point for any signed write: it rebuilds the signable bytes
/// locally from on-chain state and verifies them against
/// `descriptor.message_hex` before invoking the wallet. See
/// `rebuildAndVerifyMessage` and SECURITY.md surface A.
export function useSignWithWallet() {
  const {
    signMessage,
    publicKey,
    connected,
    isLedger,
    ledgerPublicKey,
  } = useWallet();
  const { connection } = useConnection();

  const signBytes = useCallback(
    async (
      messageBytes: Uint8Array,
      options?: SignOptions,
    ): Promise<SignedPayload> => {
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
      // Effective signer pubkey: caller's preference if set, else
      // the default. The signature has to verify against THIS pubkey,
      // and `signer_pubkey` we return MUST match - otherwise the
      // backend's submit hands the on-chain program a sig + pubkey
      // pair that fails verify.
      const effectiveSigner = options?.preferSigner ?? publicKey;
      let sig: Uint8Array;
      try {
        sig = await signMessage(messageBytes, options?.preferSigner);
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
        !nacl.sign.detached.verify(
          messageBytes,
          sig,
          effectiveSigner.toBytes(),
        )
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
        signer_pubkey: effectiveSigner.toBase58(),
        signature: toHex(sig),
      };
    },
    [connected, publicKey, signMessage]
  );

  /// Rebuild the signable bytes from chain state, verify they match
  /// the backend-supplied `message_hex`, then ask the wallet to sign
  /// the locally-rebuilt bytes. Throws `WalletSignError` with code
  /// `"message_mismatch"` if the backend tried to swap them.
  ///
  /// Pass `options.preferSigner` (resolved via
  /// `useWallet().pickSigner(approvers)`) when the wallet's on-chain
  /// approver list dictates which of the user's available pubkeys
  /// must produce the signature.
  const signDescriptor = useCallback(
    async (
      descriptor: DryRunDescriptor,
      options?: SignOptions,
    ): Promise<SignedPayload> => {
      ensureDescriptorFresh(descriptor);
      const flavor = messageFlavorForSigner({
        preferSigner: options?.preferSigner,
        isLedger,
        ledgerPublicKey,
      });
      try {
        return await signDescriptorWithFlavor(
          descriptor,
          options,
          flavor,
        );
      } catch (err) {
        if (
          flavor === "plain_v2" &&
          isLedger &&
          err instanceof WalletSignError &&
          err.code === "wallet_signed_wrong_bytes"
        ) {
          return signDescriptorWithFlavor(
            descriptor,
            options,
            "offchain_v1",
          );
        }
        if (
          flavor === "offchain_v1" &&
          !isLedger &&
          err instanceof WalletSignError &&
          err.code === "wallet_signed_wrong_bytes"
        ) {
          return signDescriptorWithFlavor(
            descriptor,
            options,
            "plain_v2",
          );
        }
        throw err;
      }
    },
    [connection, isLedger, ledgerPublicKey, signBytes],
  );

  return {
    signBytes,
    signDescriptor,
    signTypedDescriptor,
    canSign: Boolean(connected && publicKey && signMessage),
  };

  async function signTypedDescriptor(
    descriptor: TypedDryRunDescriptor,
    options?: SignOptions,
  ): Promise<SignedPayload> {
    ensureDescriptorFresh(descriptor);
    let bytes: Uint8Array;
    try {
      bytes = verifiedTypedClearSignMessageBytes(descriptor);
    } catch (err) {
      if (err instanceof TypedClearSignMessageVerificationError) {
        throw new WalletSignError("message_mismatch", err.message);
      }
      throw err;
    }
    if (bytes.length === 0) {
      throw new WalletSignError(
        "message_mismatch",
        "This signing request was not prepared correctly. Try again.",
      );
    }
    const signed = await signBytes(bytes, options);
    ensureDescriptorFresh(descriptor);
    return {
      ...signed,
      message_flavor: "clearsign_v2_text",
      signed_message_hex: descriptor.message_hex,
    };
  }

  async function signDescriptorWithFlavor(
    descriptor: DryRunDescriptor,
    options: SignOptions | undefined,
    flavor: MessageFlavor,
  ): Promise<SignedPayload> {
    let bytes: Uint8Array;
    try {
      bytes = await rebuildAndVerifyMessage(
        descriptor,
        connection,
        flavor,
      );
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
    const signed = await signBytes(bytes, options);
    ensureDescriptorFresh(descriptor);
    return { ...signed, message_flavor: flavor };
  }
}

function ensureDescriptorFresh(descriptor: { expiry: number }) {
  const secondsLeft = descriptor.expiry - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 15) {
    throw new WalletSignError(
      "stale_request",
      "This signing request has expired or is too close to expiry. Refresh and try again.",
    );
  }
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
