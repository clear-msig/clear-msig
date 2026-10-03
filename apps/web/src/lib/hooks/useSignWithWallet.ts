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

import { WalletSignError, ensureDescriptorFresh } from "@/lib/wallet/signingError";
import { affectsSigningReview } from "@/lib/clearsign/reviewEvents";
import { usePathname } from "next/navigation";
import { trackProviderSigning, withSigningLock } from "@/lib/clearsign/signingLock";
import { useRequestIdentity } from "@/lib/hooks/useRequestIdentity";
import { useWallet, useConnection } from "@/lib/wallet";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  fromHex,
  toHex,
} from "@/lib/msig";
import { messageFlavorForSigner } from "@/lib/hooks/signFlavor";
import type { ExpectedTypedClearSignMessage } from "@/lib/clearsign/typedMessage";
import type { DryRunDescriptor, TypedDryRunDescriptor } from "@/lib/api/types";
import type { MessageFlavor } from "@/lib/msig/offchain";
import {
  withWalletSignatureTimeout,
} from "@/lib/wallet/signing";

export interface SignOptions {
  /// When provided, route the sign through the signer whose pubkey
  /// matches. Used when the wallet's on-chain approver list dictates
  /// a specific signer (e.g. wallet was created with the embedded
  /// pubkey but the user has since connected a Ledger). Resolve via
  /// `useWallet().pickSigner(approvers)`.
  preferSigner?: PublicKey | null;
  /** Browser-rebuilt transaction binding required for typed proposal creation. */
  expectedTyped?: ExpectedTypedClearSignMessage;
  /** Preserve caller cancellation/context guards throughout review and handoff. */
  assertCurrent?: () => void;
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
  message_flavor?:
    | "offchain_v1"
    | "plain_v2"
    | "clearsign_v2_text"
    | "clearsign_v3_document"
    | "clearsign_v4_document";
  /// Hex-encoded exact message bytes the user signed. Typed ClearSign
  /// votes submit this so the program verifies the readable text.
  signed_message_hex?: string;
}

export { WalletSignError } from "@/lib/wallet/signingError";

/// Returns a stable `signBytes(messageBytes)` callback that resolves
/// with `{signer_pubkey, signature}` or throws a typed `WalletSignError`.
///
/// Also returns `signDescriptor(descriptor)` which is the preferred
/// entry point for any signed write: it rebuilds the signable bytes
/// locally from on-chain state and verifies them against
/// `descriptor.message_hex` before invoking the wallet. See
/// `rebuildAndVerifyMessage` and SECURITY.md surface A.
export function useSignWithWallet(config?: { reviewHandledBySolanaSend?: boolean; scope?: string }) {
  const identity = useRequestIdentity();
  const [, refreshRevision] = useReducer((value: number) => value + 1, 0);
  const pathname = usePathname();
  const signerWallet = useWallet();
  const scope = JSON.stringify([config?.scope, pathname, signerWallet.connected, signerWallet.dynamicPublicKey?.toBase58(), signerWallet.ledgerPublicKey?.toBase58(), signerWallet.isLedger]);
  const lifetime = useRef({ revision: 0, scope });
  if (lifetime.current.scope !== scope) {
    lifetime.current.scope = scope; lifetime.current.revision += 1;
  }
  const revision = lifetime.current.revision;
  useEffect(() => {
    const invalidate = (event: Event) => { if (affectsSigningReview(event)) { lifetime.current.revision += 1; refreshRevision(); } };
    const events = ["input", "storage", "clear:policies-changed", "clear:spending-budget-changed", "clear:personal-policy-changed"];
    for (const event of events) window.addEventListener(event, invalidate, true);
    return () => { for (const event of events) window.removeEventListener(event, invalidate, true); };
  }, []);
  const captureReview = useCallback((assertOperation?: () => void) => {
    if (!signerWallet.connected || !signerWallet.publicKey)
      throw new WalletSignError("not_connected", "Connect a wallet before reviewing a signing request.");
    const request = identity.capture();
    return () => {
      request.assertCurrent();
      assertOperation?.();
      if (revision !== lifetime.current.revision)
        throw new Error("Form or policy changed. Prepare and review the request again.");
    };
  }, [identity, revision, signerWallet.connected, signerWallet.publicKey]);
  const reviewMessage = useCallback(async (document: string, signer: string, label: string, expiry?: number, assertOperation?: () => void) => {
    const assertCurrent = captureReview(assertOperation);
    assertCurrent();
    const { requestPreparedSigningReview } = await import("@/lib/clearsign/preparedSigningReview");
    assertCurrent();
    await requestPreparedSigningReview({ document, signer, label, expiry, assertCurrent });
    assertCurrent();
    return assertCurrent;
  }, [captureReview]);
  const { signMessage, publicKey, connected, isLedger, ledgerPublicKey } =
    useWallet();
  const { connection } = useConnection();

  const signBytes = useCallback(
    async (
      messageBytes: Uint8Array,
      options?: SignOptions,
    ): Promise<SignedPayload> => {
      if (!connected || !publicKey) {
        throw new WalletSignError(
          "not_connected",
          "Connect a wallet before signing",
        );
      }
      if (!signMessage) {
        throw new WalletSignError(
          "no_sign_message",
          "This wallet does not support signMessage. Try Solflare, Backpack, or a Ledger.",
        );
      }
      // Effective signer pubkey: caller's preference if set, else
      // the default. The signature has to verify against THIS pubkey,
      // and `signer_pubkey` we return MUST match - otherwise the
      // backend's submit hands the on-chain program a sig + pubkey
      // pair that fails verify.
      const effectiveSigner = options?.preferSigner ?? publicKey;
      options?.assertCurrent?.();
      let sig: Uint8Array;
      try {
        sig = await withWalletSignatureTimeout(
          trackProviderSigning(signMessage(messageBytes, options?.preferSigner)),
        );
      } catch (err) {
        // Distinguish real user rejections from device/transport
        // errors. Treating everything as "rejected" was telling
        // users they cancelled when their Ledger had closed the
        // Solana app or the cable came loose.
        const { classifySignError } = await import("@/lib/wallet/classifySigningError");
        throw classifySignError(err);
      }
      // Local ed25519 verify. Some embedded-wallet implementations
      // (notably Dynamic's WaaS-SVM signer) UTF-8-decode the input
      // bytes before signing, so the signature ends up over a
      // different byte sequence than what we asked for. Catching
      // that here means the user gets a clean error in the browser
      // instead of a 502 from the CLI's verifier.
      // Signature verification is required, but its implementation need not
      // download on every authenticated page before anyone signs.
      const { default: nacl } = await import("tweetnacl");
      if (
        !nacl.sign.detached.verify(messageBytes, sig, effectiveSigner.toBytes())
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
          `Wallet returned an unexpected signature length (${sig.length}, want 64)`,
        );
      }
      options?.assertCurrent?.();
      return {
        signer_pubkey: effectiveSigner.toBase58(),
        signature: toHex(sig),
      };
    },
    [connected, publicKey, signMessage],
  );

  const signDescriptorWithFlavor = useCallback(
    async (
      descriptor: DryRunDescriptor,
      options: SignOptions | undefined,
      flavor: MessageFlavor,
    ): Promise<SignedPayload> => {
      const assertCurrent = captureReview(options?.assertCurrent);
      assertCurrent();
      const { signPreparedLegacy } = await import("@/lib/clearsign/preparedSigning");
      assertCurrent();
      return signPreparedLegacy({ descriptor, options, flavor, connection, signBytes, reviewMessage, publicKey });
    },
    [connection, signBytes, reviewMessage, publicKey, captureReview],
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
    ): Promise<SignedPayload> => withSigningLock(async () => {
      descriptor = Object.freeze({ ...descriptor });
      options = options ? { ...options } : undefined;
      ensureDescriptorFresh(descriptor);
      const flavor = messageFlavorForSigner({
        preferSigner: options?.preferSigner,
        isLedger,
        ledgerPublicKey,
      });
      try {
        return await signDescriptorWithFlavor(descriptor, options, flavor);
      } catch (err) {
        if (
          flavor === "plain_v2" &&
          isLedger &&
          err instanceof WalletSignError &&
          err.code === "wallet_signed_wrong_bytes"
        ) {
          return signDescriptorWithFlavor(descriptor, options, "offchain_v1");
        }
        if (
          flavor === "offchain_v1" &&
          !isLedger &&
          err instanceof WalletSignError &&
          err.code === "wallet_signed_wrong_bytes"
        ) {
          return signDescriptorWithFlavor(descriptor, options, "plain_v2");
        }
        throw err;
      }
    }),
    [isLedger, ledgerPublicKey, signDescriptorWithFlavor],
  );

  /**
   * Sign a caller-built clear-text message for local/browser authority
   * (agent practice budgets, owner approvals). Never pass backend-supplied
   * hex — rebuild the message in the browser first. Money-moving and
   * on-chain governance must use `signDescriptor` / `signTypedDescriptor`.
   */
  const signLocalClearText = useCallback(
    async (
      clearText: string,
      options?: SignOptions,
    ): Promise<SignedPayload> => withSigningLock(async () => {
      options = options ? { ...options } : undefined;
      const text = clearText.trim();
      if (text.length < 8) {
        throw new WalletSignError(
          "message_mismatch",
          "Local approval message is empty or too short.",
        );
      }
      // Reject opaque hex blobs that look like a backend-supplied payload
      // rather than human-readable clear text.
      const compact = text.replace(/\s+/g, "");
      if (
        compact.length >= 64 &&
        /^[0-9a-fA-F]+$/.test(compact) &&
        !text.includes(" ")
      ) {
        throw new WalletSignError(
          "message_mismatch",
          "Refusing to sign an opaque hex payload. Rebuild a readable local message first.",
        );
      }
      const assertCurrent = await reviewMessage(text, (options?.preferSigner ?? publicKey)?.toBase58() ?? "", "Local-only permission", undefined, options?.assertCurrent);
      const signed = await signBytes(new TextEncoder().encode(text), options);
      assertCurrent();
      return signed;
    }),
    [signBytes, reviewMessage, publicKey],
  );

  return {
    signBytes,
    signLocalClearText,
    signDescriptor,
    signTypedDescriptor,
    canSign: Boolean(connected && publicKey && signMessage),
  };

  async function signTypedDescriptor(
    descriptor: TypedDryRunDescriptor,
    options?: SignOptions,
  ): Promise<SignedPayload> {
    return withSigningLock(async () => {
    options = options ? { ...options, expectedTyped: options.expectedTyped ? { ...options.expectedTyped } : undefined } : undefined;
    descriptor = Object.freeze({ ...descriptor });
    const assertCurrent = captureReview(options?.assertCurrent);
    assertCurrent();
    const { signPreparedTyped } = await import("@/lib/clearsign/preparedSigning");
    assertCurrent();
    return signPreparedTyped({ descriptor, options, connection, signBytes, reviewMessage, captureReview, config });
    });
  }
}
