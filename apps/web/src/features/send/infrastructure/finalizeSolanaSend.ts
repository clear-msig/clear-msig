import { backendApi } from "@/lib/api/endpoints";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import type { IntentAccount } from "@/lib/msig";
import { ProposalStatus } from "@/lib/msig";
import { assertPolicyNotDenied, resolvePolicyEnforcement } from "@/lib/policies/enforce";
import { isProposalNotApprovedError, waitForSolanaProposalStatus } from "@/features/send/infrastructure/solanaProposalStatus";
import { lamportsToSafeNumber, tagExecuteFailure } from "@/features/send/domain/solanaSend";
import type { ExecuteSolanaSendInput } from "@/features/send/infrastructure/executeSolanaSend";
import type { PublicKey } from "@solana/web3.js";

interface FinalizeSolanaSendInput {
  input: ExecuteSolanaSendInput;
  submitted: Record<string, unknown>;
  proposal: string;
  destination: string;
  proposerPk: PublicKey;
  lamportsBigint: bigint;
  intent: IntentAccount;
}

export async function finalizeSolanaSend({ input, submitted, proposal, destination, proposerPk, lamportsBigint, intent }: FinalizeSolanaSendInput) {
  const { wallet, connection, signTypedDescriptor, walletName, amount, setPhase } = input;
      const approverPk = wallet.pickSigner(intent.approvers);
      const approver = approverPk?.toBase58() ?? null;

      // 4. If the user is also an approver, flip their bit - but
      //    only if propose didn't already do it on chain (program
      //    auto-approves proposer when proposer ∈ approvers).
      const userIsApprover = approver !== null;
      const decision = await approveIfNeeded(connection, proposal, {
        approvers: intent.approvers,
        approverPubkey: approver,
      });
      let needsOwnApprove =
        userIsApprover && decision.needsApproveSignature;
      if (userIsApprover && decision.status === null) {
        const observedStatus = await waitForSolanaProposalStatus(
          connection,
          proposal,
        );
        needsOwnApprove = observedStatus === ProposalStatus.Active;
      }
      if (needsOwnApprove) {
        if (!approverPk || !approver) {
          throw new Error(
            "This connected wallet cannot approve sends for this shared wallet.",
          );
        }
        setPhase("approving");
        try {
          const approveDry = await backendApi.prepare.approveTypedProposal(
            walletName,
            proposal,
            { actor_pubkey: approver },
          );
          const approveSigned = await signTypedDescriptor(approveDry, {
            preferSigner: approverPk,
          });
          await backendApi.submit.approveTypedProposal(walletName, proposal, {
            ...approveSigned,
            expiry: approveDry.expiry,
          });
        } catch (err) {
          // Don't poison the send if the user cancels the approve
          // popup - the proposal is already on chain and they (or
          // their friends) can approve it later from the inbox.
          console.warn("[send] propose ok but approve step failed", err);
          return submitted;
        }
      }

      const policyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: 0,
        recipient: destination,
        ticker: "SOL",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(policyPlan);
      if (policyPlan.evaluation?.matched) {
        if (policyPlan.rule?.action === "require-extra-approvers") {
          const alreadyCovered = new Set<string>([
            proposerPk.toBase58(),
            ...(approver ? [approver] : []),
          ]);
          const uniqueExtraApprovers = policyPlan.extraApprovers.filter((addr) => {
            const normalized = addr.trim();
            if (!normalized || alreadyCovered.has(normalized)) return false;
            alreadyCovered.add(normalized);
            return true;
          });

          if (uniqueExtraApprovers.length === 0) {
            throw new Error(
              `Policy "${policyPlan.rule.name}" requires extra approvers, but none were configured.`,
            );
          }

          for (const extraApprover of uniqueExtraApprovers) {
            const extraSigner = wallet.pickSigner([extraApprover]);
            if (!extraSigner) {
              throw new Error(
                `Policy "${policyPlan.rule.name}" requires ${extraApprover} to approve this send, but none of your connected wallets can sign as that approver.`,
              );
            }
            if (!intent.approvers.includes(extraApprover)) {
              throw new Error(
                `Policy "${policyPlan.rule.name}" requires ${extraApprover} to approve this send, but that signer is not in the wallet's approver list.`,
              );
            }

            setPhase("approving");
            const extraDry = await backendApi.prepare.approveTypedProposal(
              walletName,
              proposal,
              { actor_pubkey: extraSigner.toBase58() },
            );
            const extraSigned = await signTypedDescriptor(extraDry, {
              preferSigner: extraSigner,
            });
            await backendApi.submit.approveTypedProposal(walletName, proposal, {
              ...extraSigned,
              expiry: extraDry.expiry,
            });
          }
        } else if (
          policyPlan.rule?.action === "require-cooldown" &&
          policyPlan.extraCooldownSeconds > 0
        ) {
          setPhase("cooldown");
          await new Promise((resolve) =>
            setTimeout(resolve, policyPlan.extraCooldownSeconds * 1000),
          );
        }
      }

      // 5. Execute only after the proposal account says it is
      //    Approved. Do not infer this from a local approval count:
      //    old/new program versions, RPC lag, policy-added approvers,
      //    and explicit approve retries can all make local counting
      //    wrong. The chain account is the source of truth.
      const statusBeforeExecute = await waitForSolanaProposalStatus(
        connection,
        proposal,
      );
      if (statusBeforeExecute === ProposalStatus.Approved) {
        setPhase("executing");
        let executed: unknown;
        try {
          executed = await backendApi.executeTypedSolSend(walletName, proposal, {
            recipient: destination,
            amountLamports: lamportsToSafeNumber(lamportsBigint),
          });
        } catch (err) {
          // If an RPC race means the backend still sees Active while
          // our read briefly saw Approved, keep the request on chain
          // and show the waiting-for-approvals state instead of
          // turning a valid proposal into a scary failed send.
          if (isProposalNotApprovedError(err)) {
            return {
              ...submitted,
              executedTxid: null,
              awaitingApprovers: true,
            };
          }
          // Don't swallow - without this the user sees a "Sent" UX
          // even though the SOL never moved (balance stays the same
          // and they think the dashboard is broken). Re-throw with
          // the proposal address attached so onError can offer a
          // direct "retry from the proposal page" link.
          tagExecuteFailure(err, proposal);
          throw err;
        }
        // Solana sends route through the program's `execute_custom`
        // (chain_kind=0 stays on the local path), so the response
        // shape is { txid, path, status } - not the broadcast
        // wrapper EVM uses. Pull txid out so SentStage can link
        // the user to the actual on-chain transfer.
        const tid = (executed as { txid?: unknown })?.txid;
        if (typeof tid === "string" && tid.length > 0) {
          return { ...submitted, executedTxid: tid };
        }
        // execute returned without a txid - backend reached a code
        // path that didn't broadcast. Same UX risk as the throw
        // above (user sees "Sent" with no on-chain effect), so
        // surface it as a failure with the proposal link.
        const err = new Error(
          "The final send step finished but didn't return a transaction id. The request is saved - open it from the dashboard to retry.",
        );
        tagExecuteFailure(err, proposal);
        throw err;
      }
      // Threshold not met inline (multi-member wallet, threshold > 1).
      // Proposal is on chain Active; other approvers need to act
      // before SOL moves. Mark the result so onSuccess shows
      // "Proposal created" instead of "Sent" - without this, a
      // multi-member proposer would see Sent UX with no balance
      // change because the inline execute step never fires.
      return { ...submitted, executedTxid: null, awaitingApprovers: true };
}
