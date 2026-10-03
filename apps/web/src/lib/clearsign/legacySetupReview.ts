import type { DryRunDescriptor } from "@/lib/api/types";
import { parseIntent, DISC_INTENT } from "@/lib/msig/accounts";
import { fromHex, toHex } from "@/lib/msig/hash";

/** Decodes the same serialized intent body consumed by AddIntent/UpdateIntent. */
export function legacySetupReview(descriptor: DryRunDescriptor, bytes: Uint8Array): string {
  const params = fromHex(descriptor.params_data_hex);
  const lines = [`Action: ${descriptor.action}`, `Wallet: ${descriptor.wallet_name}`, `Wallet address: ${descriptor.wallet_pubkey}`];
  if (["intent_add", "intent_update"].includes(descriptor.action)) {
    const body = descriptor.action === "intent_update" ? params.subarray(1) : params;
    const account = new Uint8Array(body.length + 1); account[0] = DISC_INTENT; account.set(body, 1);
    const intent = parseIntent(account);
    if (intent.wallet !== descriptor.wallet_pubkey ||
        (descriptor.action === "intent_update" && intent.intentIndex !== params[0]))
      throw new Error("Setup definition belongs to a different wallet or intent.");
    lines.push(`Target intent: ${intent.intentIndex}`, `Chain kind: ${intent.chainKind}`,
      `Proposers:\n${intent.proposers.join("\n")}`, `Approvers:\n${intent.approvers.join("\n")}`,
      `Required approvals: ${intent.approvalThreshold}`, `Required cancellations: ${intent.cancellationThreshold}`,
      `Timelock: ${intent.timelockSeconds} seconds`, `Action template:\n${intent.template}`,
      `Permission definition (all account privileges, constraints and instruction references):\n${JSON.stringify(intent, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)}`);
  } else if (descriptor.action === "intent_remove") {
    if (params.length !== 1) throw new Error("Invalid intent removal parameters.");
    lines.push(`Remove intent: ${params[0]}`);
  } else if (["proposal_cancel", "cancel"].includes(descriptor.action)) {
    lines.push(`Cancel existing request: ${descriptor.proposal_pubkey ?? descriptor.proposal_index ?? "unknown"}`);
  } else {
    throw new Error("This legacy action lacks a supported readable setup review. Nothing was signed.");
  }
  lines.push(`Expires: ${new Date(descriptor.expiry * 1000).toISOString()}`,
    "Legacy setup uses a definition hash in its signing message. The decoded permissions above come from this app, not an independent verifier.",
    `Exact signing bytes:\n${toHex(bytes)}`);
  return lines.join("\n\n");
}
