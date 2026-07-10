import { describe, expect, it } from "vitest";

import type { TypedDryRunDescriptor } from "@/lib/api/types";
import {
  TypedClearSignMessageVerificationError,
  verifiedTypedClearSignMessageBytes,
} from "@/lib/clearsign-v2/typedMessage";
import { toHex } from "@/lib/msig";

const payloadHash =
  "08122a16809fa2402d135967016f84489a024d8ad89b0b385e8b45eede15be4d";
const envelopeHash =
  "2d4724a75961caff9e395a8d610dc4720c02bd809138e54ce2d32681bfcd9f49";

describe("typed ClearSign message verification", () => {
  it("accepts a readable typed proposal vote bound to the descriptor", () => {
    const descriptor = typedDescriptor();

    expect(verifiedTypedClearSignMessageBytes(descriptor)).toEqual(
      fromText(descriptorText()),
    );
  });

  it("rejects a vote message with a swapped envelope hash", () => {
    const descriptor = typedDescriptor({
      message_hex: toHex(
        fromText(descriptorText({ envelopeHash: "11".repeat(32) })),
      ),
    });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      TypedClearSignMessageVerificationError,
    );
  });

  it("rejects non-readable typed message bytes", () => {
    const descriptor = typedDescriptor({ message_hex: "fffeff" });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "not readable UTF-8",
    );
  });
});

function typedDescriptor(
  overrides: Partial<TypedDryRunDescriptor> = {},
): TypedDryRunDescriptor {
  return {
    action: "proposal_typed_create",
    wallet_name: "Team treasury#5qxnc7",
    wallet_pubkey: "Wallet1111111111111111111111111111111111",
    intent_index: 3,
    intent_pubkey: "Intent1111111111111111111111111111111111",
    proposal_pubkey: "Proposal111111111111111111111111111111",
    proposal_index: 1,
    action_kind: 1,
    policy_commitment_hex: "22".repeat(32),
    payload_hash_hex: payloadHash,
    envelope_hash_hex: envelopeHash,
    action_id:
      "sol-send:0xe75e86c6f1d6af5ded17d784182b7078dd84b9d58310c75ed8160e53fe9d0334",
    nonce:
      "nonce:0x1e67383e73f8a5157177cb25846b0b7da30fc3aedaa306eba0651b0e6b1f163f",
    message_hex: toHex(fromText(descriptorText())),
    message_flavor: "clearsign_v2_text",
    expiry: 1_783_426_531,
    ...overrides,
  };
}

function descriptorText(
  overrides: { envelopeHash?: string } = {},
): string {
  const hash = overrides.envelopeHash ?? envelopeHash;
  return [
    "ClearSign v2 propose",
    "Wallet Team treasury#5qxnc7",
    "Proposal 1",
    `Envelope ${hash}`,
    "",
    "Send 1 SOL from Team treasury#5qxnc7 to 886vDaZFUheowbYv4j7mU54QSvzATKr8Lb7ySuoTVXKp",
    "Requires wallet approval",
    "Wallet Team treasury#5qxnc7",
    "Action sol-send:0xe75e86c6f1d6af5ded17d784182b7078dd84b9d58310c75ed8160e53fe9d0334",
    "Nonce nonce:0x1e67383e73f8a5157177cb25846b0b7da30fc3aedaa306eba0651b0e6b1f163f",
    "Expires 2026-07-08 03:35:31",
    `Payload ${payloadHash}`,
  ].join("\n");
}

function fromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
