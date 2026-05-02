// Rebuild + verify a signable message locally before signing.
//
// Surface A in /SECURITY.md was: "the user cannot verify the wallet's
// hex bytes match the structured preview" because the frontend signed
// whatever `message_hex` the backend handed it. A compromised backend
// could swap those bytes for a different intent and the wallet would
// still produce a valid signature over them.
//
// Mitigation: the frontend now rebuilds the bytes itself from the
// canonical sources of truth (the on-chain intent account + the
// descriptor's structured fields) using `buildSignableMessage`, then
// compares against the backend-supplied `message_hex`. A mismatch
// aborts the flow before the wallet popup opens; a match means the
// bytes the user sees in the preview are the bytes the wallet will
// sign.
//
// What stays trusted:
//   - The Solana RPC (we fetch the intent account from it; if the
//     RPC lies the chain catches it on submit).
//   - The connected wallet's signMessage (no way around that).
// What no longer stays trusted:
//   - `message_hex` from the prepare endpoint (now verified).
//   - `params_data_hex` (folded into the rebuild — a swapped
//     params_data produces different bytes and fails the compare).
// What still falls back to backend trust:
//   - The descriptor's structured fields (action, expiry, wallet,
//     proposalIndex). These are user-visible in `<SignPayloadPreview>`,
//     so tampering shows up in the preview text — the preview is the
//     human consent step, the rebuild is the byte-equality check.

import { Connection, PublicKey } from "@solana/web3.js";
import {
  buildSignableMessage,
  IntentType,
  type Action,
} from "@/lib/msig/message";
import { parseIntent } from "@/lib/msig/accounts";
import { fromHex, toHex } from "@/lib/msig/hash";
import type { DryRunDescriptor } from "@/lib/api/types";

export class MessageVerificationError extends Error {
  code:
    | "intent_fetch_failed"
    | "intent_parse_failed"
    | "missing_field"
    | "message_mismatch"
    | "invalid_action";
  expected?: string;
  got?: string;
  constructor(
    code: MessageVerificationError["code"],
    message: string,
    extras?: { expected?: string; got?: string },
  ) {
    super(message);
    this.name = "MessageVerificationError";
    this.code = code;
    if (extras) {
      this.expected = extras.expected;
      this.got = extras.got;
    }
  }
}

const VALID_ACTIONS: ReadonlySet<Action> = new Set([
  "propose",
  "approve",
  "cancel",
] as const);

function asAction(s: string): Action {
  if (!VALID_ACTIONS.has(s as Action)) {
    throw new MessageVerificationError(
      "invalid_action",
      `Descriptor action ${JSON.stringify(s)} is not a recognised signable action`,
    );
  }
  return s as Action;
}

/// Take a backend-supplied descriptor, rebuild the signable bytes
/// locally from chain state, and verify they match the descriptor's
/// `message_hex`. On match, returns the rebuilt bytes (which is what
/// the caller should pass to `signMessage`). On mismatch, throws a
/// `MessageVerificationError`.
export async function rebuildAndVerifyMessage(
  descriptor: DryRunDescriptor,
  connection: Connection,
): Promise<Uint8Array> {
  if (descriptor.proposal_index === undefined || descriptor.proposal_index === null) {
    throw new MessageVerificationError(
      "missing_field",
      "Descriptor is missing proposal_index — cannot rebuild signable message",
    );
  }

  const action = asAction(descriptor.action);

  const intentPubkey = new PublicKey(descriptor.intent_pubkey);
  const accountInfo = await connection.getAccountInfo(intentPubkey, "confirmed");
  if (!accountInfo) {
    throw new MessageVerificationError(
      "intent_fetch_failed",
      `Intent account ${descriptor.intent_pubkey} not found on chain`,
    );
  }

  let parsed;
  try {
    parsed = parseIntent(new Uint8Array(accountInfo.data));
  } catch (err) {
    throw new MessageVerificationError(
      "intent_parse_failed",
      `Failed to parse on-chain intent ${descriptor.intent_pubkey}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (
    parsed.intentType !== IntentType.AddIntent &&
    parsed.intentType !== IntentType.RemoveIntent &&
    parsed.intentType !== IntentType.UpdateIntent &&
    parsed.intentType !== IntentType.Custom
  ) {
    throw new MessageVerificationError(
      "intent_parse_failed",
      `On-chain intent has unknown intentType ${parsed.intentType}`,
    );
  }

  const paramsData = fromHex(descriptor.params_data_hex);
  const { wrapped } = buildSignableMessage({
    action,
    expiry: descriptor.expiry,
    walletName: descriptor.wallet_name,
    proposalIndex: descriptor.proposal_index,
    intent: { ...parsed, intentType: parsed.intentType },
    paramsData,
  });

  const expected = fromHex(descriptor.message_hex);
  if (!equalBytes(wrapped, expected)) {
    throw new MessageVerificationError(
      "message_mismatch",
      "Backend-supplied signable message does not match the locally rebuilt bytes. The bytes shown to your wallet would not match the action you confirmed. Aborting.",
      { expected: toHex(expected), got: toHex(wrapped) },
    );
  }
  return wrapped;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  // Constant-time compare. Cheap and avoids early-out leaks even
  // though there's no remote attacker observing this loop.
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
