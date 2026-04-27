// Top-level signable-message builder.
//
// Mirror of programs/clear-wallet/src/utils/message.rs::
// MessageBuilder::build_message_for_intent. Dispatches on IntentType:
//
//   AddIntent     → "expires <ts>: <action> add intent definition_hash: <hex> | wallet: <name> proposal: <idx>"
//   RemoveIntent  → "expires <ts>: <action> remove intent <target> | wallet: <name> proposal: <idx>"
//   UpdateIntent  → "expires <ts>: <action> update intent <target> definition_hash: <hex> | wallet: <name> proposal: <idx>"
//   Custom        → "expires <ts>: <action> <rendered template> | wallet: <name> proposal: <idx>"
//
// Then `wrapOffchain(body)`. The result is the exact byte buffer the
// user's wallet must `signMessage` over . the on-chain program hashes
// the same bytes with `brine_ed25519::sig_verify`.

import { formatTimestampBytes } from "@/lib/msig/datetime";
import { sha256, toHex } from "@/lib/msig/hash";
import { wrapOffchain } from "@/lib/msig/offchain";
import { renderTemplate, type RenderContext } from "@/lib/msig/render";

export const IntentType = {
  AddIntent: 0,
  RemoveIntent: 1,
  UpdateIntent: 2,
  Custom: 3,
} as const;
export type IntentType = (typeof IntentType)[keyof typeof IntentType];

export type Action = "propose" | "approve" | "cancel";

export interface BuildMessageInput {
  action: Action;
  /// Unix timestamp. Matches the CLI's `--expiry YYYY-MM-DD HH:MM:SS`
  /// which the backend converts to a timestamp before passing to the CLI.
  expiry: number | bigint;
  walletName: string;
  proposalIndex: number | bigint;
  /// The intent this action targets. For meta-intents the caller passes
  /// the AddIntent / RemoveIntent / UpdateIntent account; for Custom,
  /// the relevant user-defined intent.
  intent: SignableIntent;
  /// `params_data` bytes . for AddIntent this is the serialized intent
  /// body; for RemoveIntent it's `[target_index]`; for UpdateIntent it's
  /// `[target_index, ...new_body]`; for Custom it's the output of
  /// `encodeParams()`.
  paramsData: Uint8Array;
}

/// Minimum intent shape required to build the message. Full
/// `IntentAccount` satisfies this plus more.
export interface SignableIntent extends RenderContext {
  intentType: IntentType;
}

/// Return the offchain-wrapped bytes the wallet signs, plus the human-
/// readable body (useful for the "what your Ledger will show" preview).
export function buildSignableMessage(
  input: BuildMessageInput
): { wrapped: Uint8Array; body: Uint8Array; bodyText: string } {
  const body = buildMessageBody(input);
  const wrapped = wrapOffchain(body);
  return {
    wrapped,
    body,
    bodyText: new TextDecoder().decode(body),
  };
}

/// Compute just the body (without the offchain header). Used by the
/// dry-run preview panel; the wallet signs `wrapOffchain(body)`.
export function buildMessageBody(input: BuildMessageInput): Uint8Array {
  const { action, expiry, walletName, proposalIndex, intent, paramsData } = input;
  const chunks: Uint8Array[] = [];
  const te = new TextEncoder();

  // "expires <ts>: <action> "
  chunks.push(te.encode("expires "));
  chunks.push(formatTimestampBytes(expiry));
  chunks.push(te.encode(": "));
  chunks.push(te.encode(action));
  chunks.push(te.encode(" "));

  // Intent-type-specific content.
  switch (intent.intentType) {
    case IntentType.AddIntent: {
      const h = sha256(paramsData);
      chunks.push(te.encode("add intent definition_hash: "));
      chunks.push(te.encode(toHex(h)));
      break;
    }
    case IntentType.RemoveIntent: {
      if (paramsData.length !== 1) {
        throw new Error(
          `buildMessageBody: RemoveIntent params_data must be 1 byte (got ${paramsData.length})`
        );
      }
      chunks.push(te.encode("remove intent "));
      chunks.push(te.encode(paramsData[0].toString(10)));
      break;
    }
    case IntentType.UpdateIntent: {
      if (paramsData.length < 2) {
        throw new Error(
          `buildMessageBody: UpdateIntent params_data must be > 1 byte (got ${paramsData.length})`
        );
      }
      const targetIdx = paramsData[0];
      const h = sha256(paramsData.subarray(1));
      chunks.push(te.encode("update intent "));
      chunks.push(te.encode(targetIdx.toString(10)));
      chunks.push(te.encode(" definition_hash: "));
      chunks.push(te.encode(toHex(h)));
      break;
    }
    case IntentType.Custom: {
      chunks.push(renderTemplate(intent, paramsData));
      break;
    }
    default: {
      const exhaustive: never = intent.intentType;
      throw new Error(`buildMessageBody: unknown IntentType ${exhaustive}`);
    }
  }

  // " | wallet: <name> proposal: <idx>"
  chunks.push(te.encode(" | wallet: "));
  chunks.push(te.encode(walletName));
  chunks.push(te.encode(" proposal: "));
  const idx = typeof proposalIndex === "bigint" ? proposalIndex : BigInt(proposalIndex);
  if (idx < 0n) throw new Error("buildMessageBody: negative proposal index");
  chunks.push(te.encode(idx.toString(10)));

  // Assemble.
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
