import type { Connection, PublicKey } from "@solana/web3.js";
import type { DryRunDescriptor, TypedDryRunDescriptor } from "@/lib/api/types";
import type { SignOptions, SignedPayload } from "@/lib/hooks/useSignWithWallet";
import type { MessageFlavor } from "@/lib/msig/offchain";
import { toHex } from "@/lib/msig/hash";
import { WalletSignError, ensureDescriptorFresh } from "@/lib/wallet/signingError";

type ReviewMessage = (document: string, signer: string, label: string, expiry?: number, assertOperation?: () => void) => Promise<() => void>;
type Shared = {
  options?: SignOptions;
  connection: Connection;
  signBytes: (bytes: Uint8Array, options?: SignOptions) => Promise<SignedPayload>;
  reviewMessage: ReviewMessage;
};
/** On-demand signing implementation. All verification remains mandatory before handoff/submission. */
export async function signPreparedLegacy({ descriptor, options, flavor, connection, signBytes, reviewMessage, publicKey }: Shared & { descriptor: DryRunDescriptor; flavor: MessageFlavor; publicKey: PublicKey | null }): Promise<SignedPayload> {
      if (["proposal_approve", "approve"].includes(descriptor.action))
        throw new WalletSignError(
          "message_mismatch",
          "Legacy approval has no complete canonical review. Open the request to inspect its blocked state.",
        );
      options?.assertCurrent?.();
      const { rebuildAndVerifyMessage, MessageVerificationError } = await import("@/lib/msig/verify");
      let bytes: Uint8Array;
      try {
        bytes = await rebuildAndVerifyMessage(descriptor, connection, flavor);
      } catch (err) {
        if (err instanceof MessageVerificationError) {
          throw new WalletSignError("message_mismatch", err.message, {
            expectedHex: err.expected,
            gotHex: err.got,
          });
        }
        throw err;
      }
      const { legacySetupReview } = await import("@/lib/clearsign/legacySetupReview");
      const assertCurrent = await reviewMessage(
        legacySetupReview(descriptor, bytes),
        (options?.preferSigner ?? publicKey)?.toBase58() ?? "", "Wallet setup or management", descriptor.expiry, options?.assertCurrent,
      );
      // Rebuild again after review: legacy setup depends on current chain state.
      const freshBytes = await rebuildAndVerifyMessage(descriptor, connection, flavor);
      assertCurrent();
      if (toHex(freshBytes) !== toHex(bytes)) throw new Error("Setup changed during review. Prepare again.");
      ensureDescriptorFresh(descriptor);
      const signed = await signBytes(bytes, options);
      assertCurrent();
      ensureDescriptorFresh(descriptor);
      return { ...signed, message_flavor: flavor };
}

export async function signPreparedTyped({ descriptor, options, connection, signBytes, reviewMessage, captureReview, config }: Shared & { descriptor: TypedDryRunDescriptor; captureReview: (assertOperation?: () => void) => () => void; config?: {reviewHandledBySolanaSend?: boolean} }): Promise<SignedPayload> {
    ensureDescriptorFresh(descriptor);
    if (
      ["proposal_typed_create", "proposal_typed_approve", "approve"].includes(
        descriptor.action,
      ) &&
      !options?.expectedTyped
    ) {
      throw new WalletSignError(
        "message_mismatch",
        "Typed proposal signing requires the transaction details rebuilt in this browser.",
      );
    }
    const assertLifecycle = captureReview(options?.assertCurrent);
    assertLifecycle();
    const { verifiedTypedClearSignMessageBytes, TypedClearSignMessageVerificationError } = await import("@/lib/clearsign/typedMessage");
    assertLifecycle();
    let bytes: Uint8Array;
    try {
      bytes = verifiedTypedClearSignMessageBytes(
        descriptor,
        options?.expectedTyped,
      );
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
    const checkChain = config?.reviewHandledBySolanaSend
      ? async () => {}
      : await (await import("@/lib/clearsign/typedSigningState")).captureTypedSigningState(connection, descriptor);
    assertLifecycle();
    const assertCurrent = config?.reviewHandledBySolanaSend
      ? captureReview(options?.assertCurrent)
      : await reviewMessage(new TextDecoder("utf-8", { fatal: true }).decode(bytes), descriptor.signer_pubkey, "Prepared action and signing decision", descriptor.expiry, options?.assertCurrent);
    assertCurrent();
    await checkChain();
    assertCurrent();
    ensureDescriptorFresh(descriptor);
    const signed = await signBytes(bytes, options);
    await checkChain();
    assertCurrent();
    if (signed.signer_pubkey !== descriptor.signer_pubkey) {
      throw new WalletSignError(
        "message_mismatch",
        "The wallet that signed does not match the signer named in this approval document.",
      );
    }
    ensureDescriptorFresh(descriptor);
    return {
      ...signed,
      message_flavor: descriptor.message_flavor,
      signed_message_hex: descriptor.message_hex,
    };
}
