import { type Connection, type PublicKey } from "@solana/web3.js";
import type { WalletValue } from "@/lib/wallet/context";
import type { IntentWithPda } from "@/lib/chain/intents";
import type { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { IntentType, ProposalStatus } from "@/lib/msig";
import { requestAccountKey } from "@/lib/clearsign/requestIdentity";
import { withAutomaticLegacySetup } from "@/lib/chain/legacySetup";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { backendApi } from "@/lib/api/endpoints";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalStatus } from "@/lib/chain/proposals";
import { waitForBitcoinChangeIntent } from "./bitcoinIntent";
import { assertPreparedBitcoinSetupIsCurrent } from "../domain/bitcoin";
const BTC_TEMPLATE = "examples/intents/btc_transfer.json";
export async function setupBitcoin({
  wallet,
  connection,
  name,
  hasBinding,
  walletData,
  intents,
  signDescriptor,
  assertCurrent,
}: {
  assertCurrent: () => void;
  wallet: WalletValue;
  connection: Connection;
  name: string;
  hasBinding: boolean;
  walletData: { pda: PublicKey } | null | undefined;
  intents: IntentWithPda[];
  signDescriptor: ReturnType<typeof useSignWithWallet>["signDescriptor"];
}) {
  if (!wallet.publicKey) throw new Error("Connect your wallet first");
  if (!hasBinding) throw new Error("Bind Bitcoin to this wallet first");
  if (!walletData) throw new Error("Wallet is still loading");
  const addIntent = intents.find(
    (it) => it.account?.intentType === IntentType.AddIntent,
  );
  const signerPk = addIntent?.account
    ? wallet.pickSigner(addIntent.account.proposers)
    : wallet.publicKey;
  if (!signerPk) {
    throw new Error(
      "None of your connected wallets is in this wallet's proposer list.",
    );
  }
  return withAutomaticLegacySetup(
    {
      connection,
      assertCurrent,
      walletName: name,
      walletAddress: walletData?.pda,
      signer: signerPk,
      accountKey: requestAccountKey(
        wallet.sessionSubject,
        wallet.publicKey?.toBase58() ?? null,
      ),
      template: BTC_TEMPLATE,
    },
    async (authority, setupRecovery) => {
      const proposers = authority.proposers,
        approvers = authority.approvers,
        threshold = authority.approvalThreshold;
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        {
          plaintext: enc.encode(JSON.stringify(proposers)),
          fheType: "ebytes",
        },
        {
          plaintext: enc.encode(JSON.stringify(approvers)),
          fheType: "ebytes",
        },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
        { plaintext: new Uint8Array([0]), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");
      const dry = await backendApi.prepare.addIntent(name, {
        file: BTC_TEMPLATE,
        proposers,
        approvers,
        threshold,
        cancellation_threshold: 1,
        timelock: 0,
        policy_ciphertexts,
      });
      assertPreparedBitcoinSetupIsCurrent(dry.params_data_hex);
      assertCurrent();
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      if (!dry.proposal_pubkey)
        throw new Error(
          "Setup preparation returned no request identity. Nothing was submitted.",
        );

      setupRecovery.submitting(dry.proposal_pubkey);

      const submitted = await backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: BTC_TEMPLATE,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address");
      }
      if (proposal !== dry.proposal_pubkey)
        throw new Error(
          "Setup response returned another request. Check the prepared request before retrying.",
        );
      setupRecovery.accepted(proposal);
      const decision = await approveIfNeeded(connection, proposal, {
        approvers: addIntent?.account?.approvers,
        approverPubkey: addIntent?.account
          ? (wallet.pickSigner(addIntent.account.approvers)?.toBase58() ?? null)
          : signerPk.toBase58(),
        approvalThreshold: addIntent?.account?.approvalThreshold ?? 1,
      });
      if (decision.needsApproveSignature) {
        return { proposal, status: "pending_approval" as const };
      }
      const status = await waitForProposalStatus(connection, proposal, {
        attempts: 12,
        delayMs: 500,
        accepted: [ProposalStatus.Approved, ProposalStatus.Executed],
      });
      if (
        status === ProposalStatus.Approved ||
        status === ProposalStatus.Executed
      ) {
        assertCurrent();
        await setupRecovery.executeAndVerify(proposal, dry.params_data_hex);
      }
      if (
        status !== ProposalStatus.Approved &&
        status !== ProposalStatus.Executed
      ) {
        return { proposal, status: "pending_approval" as const };
      }
      const ready = await waitForBitcoinChangeIntent(connection, name);
      if (!ready) {
        return { proposal, status: "pending_sync" as const };
      }
      return { proposal, status: "ready" as const };
    },
  );
}
