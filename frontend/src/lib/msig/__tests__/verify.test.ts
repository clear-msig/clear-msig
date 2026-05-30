import { PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { rebuildAndVerifyMessage } from "@/lib/msig/verify";
import {
  buildSignableMessage,
  IntentType,
  type SignableIntent,
} from "@/lib/msig/message";
import { toHex } from "@/lib/msig/hash";

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ];
}

function address(byte: number): number[] {
  return new Array(32).fill(byte);
}

function vec(bytes: number[]): number[] {
  return [...u32(bytes.length), ...bytes];
}

function addressVec(addresses: number[][]): number[] {
  return [...u32(addresses.length), ...addresses.flat()];
}

function intentAccount(intentType: IntentType): Uint8Array {
  return new Uint8Array([
    2,
    ...address(1),
    255,
    0,
    intentType,
    0,
    1,
    1,
    1,
    ...u32(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...addressVec([address(2)]),
    ...addressVec([address(3)]),
    ...vec([]),
    ...vec([]),
    ...vec([]),
    ...vec([]),
    ...vec([]),
  ]);
}

describe("rebuildAndVerifyMessage", () => {
  it("returns plain body bytes for plain_v2 after matching wrapped backend bytes", async () => {
    const intentPubkey = new PublicKey("11111111111111111111111111111112");
    const paramsData = new Uint8Array([3]);
    const signableIntent: SignableIntent = {
      intentType: IntentType.RemoveIntent,
      template: "",
      params: [],
      bytePool: new Uint8Array(),
    };
    const message = buildSignableMessage({
      action: "propose",
      expiry: 1_000_000_000,
      walletName: "treasury",
      proposalIndex: 7,
      intent: signableIntent,
      paramsData,
    });
    const connection = {
      getAccountInfo: async () => ({ data: intentAccount(IntentType.RemoveIntent) }),
    } as unknown as Connection;

    const rebuilt = await rebuildAndVerifyMessage(
      {
        action: "proposal_create",
        wallet_name: "treasury",
        wallet_pubkey: PublicKey.default.toBase58(),
        intent_index: 1,
        intent_pubkey: intentPubkey.toBase58(),
        message_hex: toHex(message.wrapped),
        params_data_hex: toHex(paramsData),
        expiry: 1_000_000_000,
        proposal_index: 7,
      },
      connection,
      "plain_v2",
    );

    expect(Array.from(rebuilt)).toEqual(Array.from(message.body));
    expect(Array.from(rebuilt)).not.toEqual(Array.from(message.wrapped));
  });
});
