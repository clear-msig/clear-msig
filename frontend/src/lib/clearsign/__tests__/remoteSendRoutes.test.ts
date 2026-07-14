import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("remote send ClearSign amount contract", () => {
  it.each([
    ["src/features/send/routes/EthSendPage.tsx", "amount.trim()", "amountWei.toString()"],
    ["src/features/send/routes/BtcSendPage.tsx", "amountBtc.trim()", "sendAmountSats.toString()"],
    ["src/features/send/routes/ZecSendPage.tsx", "amount.trim()", "amountZats.toString()"],
  ])("signs a human amount and executes base units on %s", (path, human, raw) => {
    const page = source(path);
    const payload = page.slice(page.indexOf("const envelope:"), page.indexOf("const summary =", page.indexOf("const envelope:")));
    const execution = page.slice(page.indexOf("executeTypedChainSend"));

    expect(payload).toContain(`amount: ${human}`);
    expect(payload).not.toContain(`amount: ${raw}`);
    expect(execution).toContain(`amountRaw: ${raw}`);
  });

  it("binds ERC-20 human amount, contract identity, symbol, and token decimals", () => {
    const page = source("src/features/send/routes/Erc20SendPage.tsx");
    const start = page.indexOf("const envelope:");
    const payload = page.slice(start, page.indexOf("const summary =", start));
    const execution = page.slice(page.indexOf("executeTypedChainSend", start));

    expect(payload).toContain("amount: amount.trim()");
    expect(payload).toContain("asset: tokenForClearSign");
    expect(payload).toContain("decimals: meta.decimals");
    expect(payload).toContain("displayAsset: meta.symbol");
    expect(execution).toContain("amountRaw: amountBase.toString()");
    expect(execution).toContain("assetIdHash: textCommitmentHex(tokenForClearSign)");
  });
});
