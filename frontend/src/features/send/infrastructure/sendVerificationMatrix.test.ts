import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEND_ASSET_VERIFICATIONS,
  SEND_SIGNER_RUNTIMES,
  sendVerificationEnvelope,
  type SendSignerRuntime,
} from "@/features/send/domain/sendVerificationMatrix";
import {
  clearSignVoteMessage,
  summarizeClearSignAction,
} from "@/lib/clearsign/actions";
import { signMessageWithInjectedProvider } from "@/lib/wallet/injectedSolana";
import { signDynamicSolanaMessage } from "@/features/wallet-runtime/infrastructure/dynamicSolanaMessageSigner";

afterEach(() => vi.unstubAllGlobals());

describe("supported send signing matrix", () => {
  it.each(SEND_ASSET_VERIFICATIONS)(
    "$id route binds readable review, typed proposal, and the expected executor",
    (asset) => {
      const source = readFileSync(resolve(process.cwd(), asset.routeSource), "utf8");
      expect(source).toContain("prepareClearSignAction");
      expect(source).toContain("prepare.createTypedProposal");
      expect(source).toContain("expectedTyped:");
      expect(source).toContain(asset.executionMarker);

      const summary = summarizeClearSignAction(sendVerificationEnvelope(asset));
      expect(summary.signableText).toContain(asset.payload.amount);
      expect(summary.signableText).toContain(
        asset.payload.displayAsset ?? asset.payload.asset,
      );
      expect(summary.signableText).toContain(asset.payload.recipient);
      expect(summary.signableText).toContain(asset.payload.note);
    },
  );

  const cases = SEND_SIGNER_RUNTIMES.flatMap((signer) =>
    SEND_ASSET_VERIFICATIONS.map((asset) => ({ signer, asset })),
  );

  it.each(cases)(
    "$signer signs the exact readable $asset.id approval bytes",
    async ({ signer, asset }) => {
      const seedByte = SEND_SIGNER_RUNTIMES.indexOf(signer) + 1;
      const keypair = nacl.sign.keyPair.fromSeed(
        new Uint8Array(32).fill(seedByte),
      );
      const summary = summarizeClearSignAction(sendVerificationEnvelope(asset));
      const bytes = clearSignVoteMessage({
        voteKind: "propose",
        walletName: "Signing matrix",
        signerPubkey: new PublicKey(keypair.publicKey).toBase58(),
        proposalIndex: 1,
        envelopeHash: summary.envelopeHash,
        signableText: summary.signableText,
        expiresAt: sendVerificationEnvelope(asset).expiresAt,
        approvalsRequired: 2,
        approvalsAfter: 1,
      });

      const signature = await signForRuntime(signer, keypair, bytes);

      expect(signature).toHaveLength(64);
      expect(nacl.sign.detached.verify(bytes, signature, keypair.publicKey)).toBe(
        true,
      );
    },
  );
});

async function signForRuntime(
  runtime: SendSignerRuntime,
  keypair: nacl.SignKeyPair,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const sign = (message: Uint8Array) =>
    Promise.resolve(nacl.sign.detached(message, keypair.secretKey));

  if (runtime === "google-waas") {
    return signDynamicSolanaMessage(
      { getSigner: async () => ({ signMessage: sign }) },
      bytes,
    );
  }
  if (runtime === "turnkey-legacy") {
    return signDynamicSolanaMessage(
      { connector: { signUint8ArrayMessage: sign } },
      bytes,
    );
  }

  const expectedPublicKey = new PublicKey(keypair.publicKey);
  const provider = {
    publicKey: { toString: () => expectedPublicKey.toBase58() },
    signMessage: sign,
    ...(runtime === "phantom" ? { isPhantom: true } : { isSolflare: true }),
  };
  vi.stubGlobal(
    "window",
    runtime === "phantom"
      ? { phantom: { solana: provider } }
      : { solflare: provider },
  );
  const signature = await signMessageWithInjectedProvider({
    connectorKey: runtime,
    expectedPublicKey,
    bytes,
  });
  if (!signature) throw new Error(`${runtime} did not return a signature`);
  return signature;
}
