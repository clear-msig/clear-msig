import type { Connection } from "@solana/web3.js";
import { readCanonicalProposalReview } from "./readProposalReview";
import { requestRecovery, type RequestRecoveryStore } from "./requestRecovery";
import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
import { savedProposalError } from "./inlineApproval";

/** Immutable preparation snapshot; storage is a hint, never execution authority. */
export type CanonicalExecutionBinding = Readonly<{
  actionKindCode: number;
  envelopeHash: string;
  payloadHash: string;
  signableText: string;
}>;
export type CanonicalActionOutcome = {
  state: "confirmed" | "submitted" | "unknown" | "waiting";
  txid?: string;
};
export function canonicalExecutionBinding(
  value: CanonicalExecutionBinding,
): CanonicalExecutionBinding {
  if (
    !Number.isInteger(value.actionKindCode) ||
    !/^[0-9a-f]{64}$/.test(value.envelopeHash) ||
    !/^[0-9a-f]{64}$/.test(value.payloadHash) ||
    !value.signableText.startsWith("ClearSig Approval\n\n")
  )
    throw new Error(
      "The immutable canonical execution binding is unavailable.",
    );
  return Object.freeze({
    actionKindCode: value.actionKindCode,
    envelopeHash: value.envelopeHash,
    payloadHash: value.payloadHash,
    signableText: value.signableText,
  });
}
const PATHS: Record<number, string> = {
  6: "typed_wallet_policy_update",
  16: "typed_asset_policy_update",
  9: "typed_agent_trade_approval",
  12: "typed_agent_session_grant",
  13: "typed_agent_risk_policy",
  14: "typed_agent_trade_settlement",
};
type Review = Awaited<ReturnType<typeof readCanonicalProposalReview>>;
export function assertCanonicalExecutionBinding(
  review: Review,
  binding: CanonicalExecutionBinding,
) {
  canonicalExecutionBinding(binding);
  if (
    review.binding.actionKind !== binding.actionKindCode ||
    review.envelopeHash !== binding.envelopeHash ||
    review.payloadHash !== binding.payloadHash ||
    review.document !== binding.signableText
  )
    throw new Error(
      "The finalized proposal does not match this exact canonical action.",
    );
}
/** Only the finalized, genesis-pinned canonical account read proves Solana execution.
 * A valid signature is submission evidence only; neither outcome proves venue execution.
 * Once sent, every retry is read-only reconciliation, including after a lost response.
 */
export async function executeCanonicalAction(
  input: {
    connection: Connection;
    walletName: string;
    proposal: string;
    binding: CanonicalExecutionBinding;
    expectedActionKind: number;
    expectedWallet: string;
    assertAction?: (document: string) => void;
    accountKey: string;
    assertCurrent: () => void;
    execute?: () => Promise<unknown>;
  },
  deps: {
    read?: typeof readCanonicalProposalReview;
    recovery?: RequestRecoveryStore;
  } = {},
): Promise<CanonicalActionOutcome> {
  const read = deps.read ?? readCanonicalProposalReview;
  const store = deps.recovery ?? requestRecovery;
  const { connection, proposal, walletName, binding, assertCurrent } = input;
  assertCurrent();
  const before = await read(connection, proposal, walletName);
  assertCurrent();
  assertCanonicalExecutionBinding(before, binding);
  if (
    binding.actionKindCode !== input.expectedActionKind ||
    before.binding.wallet !== input.expectedWallet
  )
    throw new Error(
      "Canonical execution belongs to a different action or wallet.",
    );
  input.assertAction?.(before.document);
  if (before.status === 2) {
    store.resolveExecution(connection.rpcEndpoint, proposal);
    return { state: "confirmed" };
  }
  const existing = store.executionFor(connection.rpcEndpoint, proposal);
  if (existing)
    return {
      state: existing.outcome === "submitted" ? "submitted" : "unknown",
      txid: existing.txid,
    };
  if (before.status === 0) return { state: "waiting" };
  if (!input.execute) return { state: "unknown" };
  if (before.status !== 1)
    throw new Error("The canonical request is not approved for execution.");
  const path = PATHS[binding.actionKindCode];
  if (!path)
    throw new Error("This action has no supported canonical executor.");
  const recovery = store.begin({
    walletName,
    endpoint: connection.rpcEndpoint,
    accountKey: input.accountKey,
    label: "Canonical action execution",
    identity: [
      "canonical-execution",
      proposal,
      binding.envelopeHash,
      binding.payloadHash,
    ],
    phase: "execution",
  });
  try {
    assertCurrent();
    recovery.submitting(proposal);
    let response: unknown;
    try {
      response = await input.execute();
    } catch {
      assertCurrent();
      return { state: "unknown" };
    }
    let txid: string;
    try {
      txid = solanaSubmissionTxid(response, {
        proposal,
        path,
        requireProposal: true,
      });
    } catch {
      assertCurrent();
      return { state: "unknown" };
    }
    recovery.accepted(proposal, txid);
    assertCurrent();
    let confirmed = false;
    try {
      const after = await read(connection, proposal, walletName);
      assertCanonicalExecutionBinding(after, binding);
      confirmed =
        after.status === 2 && after.binding.wallet === input.expectedWallet;
    } catch {
      /* A read failure or mismatch cannot establish completion. Keep submission locked. */
    }
    assertCurrent();
    if (confirmed) {
      recovery.complete();
      return { state: "confirmed", txid };
    }
    return { state: "submitted", txid };
  } finally {
    recovery.finish();
  }
}
export function requireCanonicalCompletion(
  outcome: CanonicalActionOutcome,
  proposal: string,
): void {
  if (outcome.state !== "confirmed")
    throw savedProposalError(
      proposal,
      new Error(
        outcome.state === "submitted"
          ? "Execution submitted; finalized verification is pending. Do not repeat it."
          : "Execution outcome is unknown. Check the existing request; do not repeat it.",
      ),
      true,
    );
}

const rememberedBindings = new Map<string, CanonicalExecutionBinding>();
const bindingKey = (endpoint: string, proposal: string) =>
  `clearsig:execution-binding:v1:${JSON.stringify([endpoint, proposal])}`;
export function rememberExecutionBinding(
  endpoint: string,
  proposal: string,
  value: CanonicalExecutionBinding,
): CanonicalExecutionBinding {
  const binding = canonicalExecutionBinding(value),
    key = bindingKey(endpoint, proposal);
  rememberedBindings.set(key, binding);
  try {
    if (typeof window !== "undefined")
      window.sessionStorage.setItem(key, JSON.stringify(binding));
  } catch {
    /* memory is still available; this grants no authority */
  }
  return binding;
}
export function savedExecutionBinding(
  endpoint: string,
  proposal: string,
  value?: CanonicalExecutionBinding,
): CanonicalExecutionBinding {
  if (value) return canonicalExecutionBinding(value);
  const key = bindingKey(endpoint, proposal);
  const memory = rememberedBindings.get(key);
  if (memory) return memory;
  try {
    if (typeof window !== "undefined") {
      const stored = window.sessionStorage.getItem(key);
      if (stored) return canonicalExecutionBinding(JSON.parse(stored));
    }
  } catch {
    /* missing/tampered metadata cannot establish authority */
  }
  throw savedProposalError(
    proposal,
    new Error(
      "The original immutable action binding is unavailable on this device. Open the canonical request for review; automatic execution is blocked.",
    ),
    true,
  );
}
