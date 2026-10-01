import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SentStage as Evm } from "./evm/EvmNativeSendResults";
import { SentStage as Erc20 } from "./evm/Erc20SendResults";
import { SentStage as Zcash } from "./zcash/ZcashSendStages";
import { SentCard as Bitcoin } from "./bitcoin/BtcSendResults";
const shared = { walletName: "fixture", walletDisplay: "Fixture", amount: "1", to: "Synthetic destination", explorerUrl: null, explorerLabel: "Explorer", reduce: true, pending: false, proposal: "11111111111111111111111111111111" };
describe("actual broadcast receipt components", () => {
  it.each([
    React.createElement(Evm, { ...shared, pending: true, ticker: "ETH", networkLabel: "Sepolia" }),
    React.createElement(Erc20, { ...shared, pending: true, symbol: "TEST" }),
  ])("keeps under-approved requests pending without claiming broadcast", (element) => {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Request created");
    expect(html).toContain("Waiting for remaining approvals");
    expect(html).not.toContain("Transfer submitted");
    expect(html).not.toContain("Send confirmed");
  });
  it.each([
    React.createElement(Evm, { ...shared, ticker: "ETH", networkLabel: "Sepolia" }),
    React.createElement(Erc20, { ...shared, symbol: "TEST" }),
    React.createElement(Zcash, { ...shared, note: "" }),
    React.createElement(Bitcoin, { walletName: "fixture", walletDisplay: "Fixture", network: "testnet", onAnother: () => {}, sent: { amountBtc: "1", to: "Synthetic destination", note: "", txid: "a".repeat(64), explorerUrl: null } }),
  ])("labels a broadcast as submitted rather than confirmed", (element) => {
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Transfer submitted");
    expect(html).toContain("confirmation pending");
    expect(html).not.toContain("Send confirmed");
    expect(html).not.toContain("Confirmed on");
  });
});
