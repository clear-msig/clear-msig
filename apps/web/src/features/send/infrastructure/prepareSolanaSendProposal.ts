import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { prepareClearSignV4Action, clearSignProfileForSigner, type ClearSignIntentInput, type SendPayload } from "@/lib/clearsign";
import { liveUsdEstimate } from "@/lib/clearsign/fiatEstimate";
import { assertPolicyNotDenied, resolvePolicyEnforcement } from "@/lib/policies/enforce";
import { resolvePersistentSendPolicy } from "@/lib/policies/persistentWalletPolicy";
import { evaluatePolicy, PolicyViolationError } from "@/lib/retail/policyEvaluation";
import { policyCommitmentHex, randomActionLabel } from "@/features/send/domain/solanaSend";
import type { ExecuteSolanaSendInput } from "@/features/send/infrastructure/executeSolanaSend";

export async function prepareSolanaSendProposal(input: ExecuteSolanaSendInput) {
  const { wallet, connection, signTypedDescriptor, firstIntent, walletPda, walletName, amount, numericAmount, note, resolved, budgetUsage, setPhase } = input;
if (!wallet.publicKey)
        throw new Error("Connect your wallet first");
      if (!firstIntent || !firstIntent.account)
        throw new Error("Spending isn't set up for this wallet");
      // Propose and approve are separate roles. Many retail wallets use
      // the same member for both, but split-role wallets must sign the
      // proposal with a proposer and the follow-up vote with an approver.
      const proposerPk = wallet.pickSigner(
        firstIntent.account.proposers,
      );
      if (!proposerPk) {
        throw new Error(
          "This connected wallet cannot propose sends for this shared wallet. " +
            "Switch to a wallet that can propose here, or ask an owner to add this wallet.",
        );
      }
      const destination =
        resolved.kind === "contact"
          ? resolved.contact.address
          : resolved.kind === "address"
            ? resolved.address
            : resolved.kind === "sns"
              ? resolved.address
              : null;
      if (!destination)
        throw new Error("Pick a contact or paste an address");

      const submitPolicyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: 0,
        recipient: destination,
        ticker: "SOL",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(submitPolicyPlan);
      if (!walletPda) {
        throw new Error("Wallet is still loading. Try again.");
      }
      const onchainPolicy = await resolvePersistentSendPolicy(
        connection,
        walletPda,
        walletName,
        0,
      );

      // Policy pre-flight. Block before the signing request opens so the
      // user never signs a doomed send. Sources of truth: localStorage
      // allowlist + time window + per-friend allowance + wallet-wide
      // budget. The local evaluator gives immediate feedback; typed policy
      // bytes independently enforce supported constraints on chain.
      const policy = evaluatePolicy({
        walletName,
        recipientAddress: destination,
        amountSol: numericAmount,
        ticker: "SOL",
        spentUsdThisWindow: budgetUsage.spentUsd,
        spentUsdByChain: Object.fromEntries(
          budgetUsage.perChain.map((c) => [c.ticker, c.spentUsd]),
        ),
      });
      if (!policy.ok) {
        throw new PolicyViolationError(policy.violations);
      }

      // SOL → lamports. Solana's smallest unit, 1 SOL = 1e9 lamports.
      const lamports = Math.round(numericAmount * 1_000_000_000);
      const lamportsBigint = BigInt(lamports);
      // 1. Prepare a typed ClearSign proposal. This binds the
      // exact recipient account + lamports to the message the user
      // signs, and the Solana program recomputes those bytes before
      // moving funds from the vault.
      setPhase("preparing");
      const actionId = randomActionLabel("sol-send");
      const nonce = randomActionLabel("nonce");
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const policyCommitment =
        onchainPolicy?.commitmentHex ??
        policyCommitmentHex([
          `wallet:${walletPda.toBase58()}`,
          `intent:${firstIntent.account.intentIndex}`,
          `threshold:${firstIntent.account.approvalThreshold ?? ""}`,
          `proposers:${firstIntent.account.proposers.join(",")}`,
          `approvers:${firstIntent.account.approvers.join(",")}`,
        ]);
      const envelope: ClearSignIntentInput<SendPayload> = {
        kind: "send",
        network: "Solana devnet",
        walletName,
        walletId: walletPda.toBase58(),
        actionId,
        nonce,
        expiresAt,
        policyCommitment,
        payload: {
          recipient: destination,
          recipientEncoding: "solana_pubkey",
          amount,
          asset: "SOL",
          note: note.trim() || undefined,
          fiatEstimate: liveUsdEstimate(amount, "SOL"),
        },
      };
      const summary = await prepareClearSignV4Action(envelope, {
        intentIndex: firstIntent.account.intentIndex,
        actorPubkey: proposerPk.toBase58(),
        policyBytesHex: onchainPolicy?.hex,
        deviceProfile: clearSignProfileForSigner(wallet, proposerPk),
      });
      const dry = await backendApi.prepare.createTypedProposal(walletName, {
        intent_index: firstIntent.account.intentIndex,
        action_kind: summary.actionKindCode,
        policy_commitment: summary.policyCommitment,
        payload_hash: summary.payloadHash,
        envelope_hash: summary.envelopeHash,
        action_id: envelope.actionId,
        nonce: envelope.nonce,
        policyBytesHex: onchainPolicy?.hex,
        signable_text: summary.signableText,
        canonical_intent_hex: summary.canonicalIntentHex,
        expiry: formatUnixSigningExpiry(envelope.expiresAt),
        actor_pubkey: proposerPk.toBase58(),
      });

      // 2. Sign with the user's wallet.
      setPhase("signing");
      const signed = await signTypedDescriptor(dry, {
        preferSigner: proposerPk,
        expectedTyped: {
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          signableText: summary.signableText,
        },
      });

      // 3. Submit typed proposal. The program auto-approves when
      // the proposer is also an approver, so common 1-of-1 sends
      // continue to be one wallet popup.
      setPhase("submitting");
      const submitted = (await backendApi.submit.createTypedProposal(
        walletName,
        {
          ...signed,
          expiry: dry.expiry,
          intent_index: dry.intent_index,
          action_kind: dry.action_kind,
          policy_commitment: dry.policy_commitment_hex,
          payload_hash: dry.payload_hash_hex,
          envelope_hash: dry.envelope_hash_hex,
          action_id: dry.action_id,
          nonce: dry.nonce,
          policyBytesHex: onchainPolicy?.hex,
          canonical_intent_hex: dry.canonical_intent_hex,
        },
      )) as Record<string, unknown>;
  return {
    submitted,
    destination,
    proposerPk,
    lamportsBigint,
    intent: firstIntent.account,
  };
}
