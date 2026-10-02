import { captureSolanaPolicyReview } from "./solanaPolicyReview";
import type { Connection, PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import type { listIntents } from "@/lib/chain/intents";
import { prepareClearSignV4Action, clearSignProfileForSigner, type ClearSignIntentInput, type SendPayload } from "@/lib/clearsign";
import { liveUsdEstimate } from "@/lib/clearsign/fiatEstimate";
import type { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import type { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { ProposalStatus } from "@/lib/msig";
import { assertPolicyNotDenied, resolvePolicyEnforcement } from "@/lib/policies/enforce";
import { resolvePersistentSendPolicy } from "@/lib/policies/persistentWalletPolicy";
import { evaluatePolicy, PolicyViolationError } from "@/lib/retail/policyEvaluation";
import type { WalletValue } from "@/lib/wallet/context";
import { isProposalNotApprovedError, waitForSolanaProposalStatus } from "@/features/send/infrastructure/solanaProposalStatus";
import { lamportsToSafeNumber, policyCommitmentHex, randomActionLabel, tagExecuteFailure, type ResolvedSolanaRecipient } from "@/features/send/domain/solanaSend";
import type { SolanaSendingPhase } from "@/features/send/domain/solanaSendProgress";

type IntentRow = Awaited<ReturnType<typeof listIntents>>[number];

export interface ExecuteSolanaSendInput {
  attempt: ReturnType<import("./sendRecovery").SendRecovery["begin"]>;
  wallet: WalletValue;
  connection: Connection;
  signTypedDescriptor: ReturnType<typeof useSignWithWallet>["signTypedDescriptor"];
  firstIntent: IntentRow | null;
  walletPda: PublicKey | null;
  walletName: string;
  amount: string;
  numericAmount: number;
  note: string;
  resolved: ResolvedSolanaRecipient;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
  reviewBeforeSigning: (review: import("../domain/signingReview").SigningReview) => Promise<void>;
  assertFormCurrent: () => void;
  setPhase: (phase: SolanaSendingPhase) => void;
}

import { finalizeSolanaSend } from "@/features/send/infrastructure/finalizeSolanaSend";
import { prepareSolanaSendProposal } from "@/features/send/infrastructure/prepareSolanaSendProposal";

export interface PolicyScopedSolanaSendInput extends ExecuteSolanaSendInput {
  assertPolicyCurrent: () => Promise<void>;
  activePolicyCommitment: string;
}

export async function executeSolanaSend(original: ExecuteSolanaSendInput) {
  original.attempt.assertCurrent();
  if (!original.walletPda) throw new Error("Wallet is still loading. Try again.");
  const policy = await captureSolanaPolicyReview(original.connection, original.walletPda);
  const assertPolicyCurrent = async () => {
    await policy.assertCurrent();
    original.attempt.assertCurrent();
    original.assertFormCurrent();
  };
  const input: PolicyScopedSolanaSendInput = {
    ...original, assertPolicyCurrent, activePolicyCommitment: policy.commitment,
    signTypedDescriptor: async (...args) => {
      // The real signing hook performs no await before handing these bytes to the wallet.
      await assertPolicyCurrent();
      const signed = await original.signTypedDescriptor(...args);
      await assertPolicyCurrent();
      return signed;
    },
  };
  try {
    const prepared = await prepareSolanaSendProposal(input);
    input.attempt.assertCurrent();
    const proposal = prepared.submitted.proposal;
    if (typeof proposal !== "string" || proposal.length === 0)
      throw new Error("Request identity is missing. Check the saved request before continuing.");
    const result = await finalizeSolanaSend({ input, proposal, ...prepared });
    input.attempt.assertCurrent();
    return result;
  } finally { policy.dispose(); }
}
