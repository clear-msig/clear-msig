import { describe, it, expect } from "vitest";
import {
  buildMessageBody,
  buildSignableMessage,
  IntentType,
  type SignableIntent,
} from "@/lib/msig/message";
import { ParamType, type ParamEntry } from "@/lib/msig/definition";
import { unwrapOffchain } from "@/lib/msig/offchain";
import { sha256, toHex } from "@/lib/msig/hash";

function intent(
  intentType: IntentType,
  template = "",
  params: ParamEntry[] = []
): SignableIntent {
  return {
    intentType,
    template,
    params,
    bytePool: new Uint8Array(),
  };
}

describe("buildMessageBody . meta intents", () => {
  it("AddIntent includes sha256 of params_data as definition_hash", () => {
    const paramsData = new TextEncoder().encode("my intent body");
    const hashHex = toHex(sha256(paramsData));
    const body = buildMessageBody({
      action: "propose",
      expiry: 1_900_000_000,
      walletName: "treasury",
      proposalIndex: 42,
      intent: intent(IntentType.AddIntent),
      paramsData,
    });
    expect(new TextDecoder().decode(body)).toBe(
      `expires 2030-03-17 17:46:40: propose add intent definition_hash: ${hashHex} | wallet: treasury proposal: 42`
    );
  });

  it("RemoveIntent embeds the target index as a decimal", () => {
    const body = buildMessageBody({
      action: "approve",
      expiry: 1_000_000_000,
      walletName: "t",
      proposalIndex: 0,
      intent: intent(IntentType.RemoveIntent),
      paramsData: new Uint8Array([5]),
    });
    expect(new TextDecoder().decode(body)).toBe(
      "expires 2001-09-09 01:46:40: approve remove intent 5 | wallet: t proposal: 0"
    );
  });

  it("UpdateIntent carries both target index and sha256 of new body", () => {
    const newBody = new TextEncoder().encode("new body");
    const paramsData = new Uint8Array(1 + newBody.length);
    paramsData[0] = 3;
    paramsData.set(newBody, 1);
    const hashHex = toHex(sha256(newBody));
    const body = buildMessageBody({
      action: "cancel",
      expiry: 0,
      walletName: "treasury",
      proposalIndex: 1n,
      intent: intent(IntentType.UpdateIntent),
      paramsData,
    });
    expect(new TextDecoder().decode(body)).toBe(
      `expires 1970-01-01 00:00:00: cancel update intent 3 definition_hash: ${hashHex} | wallet: treasury proposal: 1`
    );
  });

  it("RemoveIntent rejects params_data with length != 1", () => {
    expect(() =>
      buildMessageBody({
        action: "propose",
        expiry: 0,
        walletName: "t",
        proposalIndex: 0,
        intent: intent(IntentType.RemoveIntent),
        paramsData: new Uint8Array(2),
      })
    ).toThrow(/1 byte/);
  });
});

describe("buildMessageBody . custom intent", () => {
  it("renders the template into the action slot", () => {
    const params: ParamEntry[] = [
      {
        paramType: ParamType.U64,
        nameOffset: 0,
        nameLen: 0,
        constraintType: 0,
        constraintValue: 0n,
      },
    ];
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, 1n, true);
    const body = buildMessageBody({
      action: "propose",
      expiry: 1_000_000_000,
      walletName: "treasury",
      proposalIndex: 0,
      intent: {
        intentType: IntentType.Custom,
        params,
        bytePool: new Uint8Array(),
        template: "transfer {0} lamports",
      },
      paramsData: data,
    });
    expect(new TextDecoder().decode(body)).toBe(
      "expires 2001-09-09 01:46:40: propose transfer 1 lamports | wallet: treasury proposal: 0"
    );
  });
});

describe("buildSignableMessage", () => {
  it("wraps the body in a Solana offchain envelope that unwraps cleanly", () => {
    const out = buildSignableMessage({
      action: "propose",
      expiry: 0,
      walletName: "t",
      proposalIndex: 0,
      intent: intent(IntentType.RemoveIntent),
      paramsData: new Uint8Array([3]),
    });
    expect(out.bodyText).toBe(
      "expires 1970-01-01 00:00:00: propose remove intent 3 | wallet: t proposal: 0"
    );
    const unwrapped = unwrapOffchain(out.wrapped);
    expect(Array.from(unwrapped)).toEqual(Array.from(out.body));
  });

  it("can return plain body bytes for software-wallet compatibility", () => {
    const out = buildSignableMessage(
      {
        action: "propose",
        expiry: 0,
        walletName: "t",
        proposalIndex: 0,
        intent: intent(IntentType.RemoveIntent),
        paramsData: new Uint8Array([3]),
      },
      "plain_v2",
    );
    expect(out.bodyText).toBe(
      "expires 1970-01-01 00:00:00: propose remove intent 3 | wallet: t proposal: 0"
    );
    expect(Array.from(out.wrapped)).toEqual(Array.from(out.body));
  });
});
