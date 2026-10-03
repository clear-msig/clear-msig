import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ComposeStage as SolCompose } from "../ui/solana/SolanaComposeStage";
import { SentStage } from "../ui/solana/SolanaSendCompletion";
import { ComposeStage as EvmCompose } from "../ui/evm/EvmNativeSendStages";
import { ComposeStage as TokenCompose } from "../ui/evm/Erc20SendStages";
import { buildBtcPreviewDetails } from "../ui/bitcoin/bitcoinPreview";
import { buildSendPreviewWarning } from "../ui/solana/solanaSendPreview";
import { formatAmount } from "../domain/solanaSend";
import type { BudgetUsageResult } from "@/lib/hooks/useWalletBudgetUsage";
const noop = () => {};
const address = "So11111111111111111111111111111111111111112";
const evm = "0x123456789012345678901234567890123456789012";
const token = "0xabcdef0123456789abcdef0123456789abcdef0123";
const usage = { perChain: [], budget: null, spentUsd: 0, velocityHit: false } as unknown as BudgetUsageResult;
it("actual SOL compose and receipt retain a one-lamport amount", () => {
  const html = renderToStaticMarkup(createElement(SolCompose, { walletName: "Treasury", amount: "0.000000001", setAmount: noop, recipientText: address, setRecipientText: noop, note: "", setNote: noop, resolved: { kind: "address", address }, savedNewContact: false, onSaveNewContact: noop, canSubmit: true, onSubmit: noop, waitingForRule: false, budgetUsage: usage, pendingUsd: 0, vaultBalanceLamports: 10001n, balanceLoading: false, insufficientBalance: false, signerBlocked: false, feeReserveLamports: 5000n, approvalThreshold: 1, timelockSeconds: 0 }));
  expect(html).toContain("Send 0.000000001 SOL");
  expect(html).toContain('value="0.000000001"');
  const receipt = renderToStaticMarkup(createElement(SentStage, { amountDisplay: formatAmount("0.000000001"), recipientDisplay: address, walletName: "Treasury", walletDisplay: "Treasury", executedTxid: null, reduce: true }));
  expect(receipt).toContain("0.000000001");
});
it("actual EVM review retains full resolved addresses and one wei", () => {
  const html = renderToStaticMarkup(createElement(EvmCompose, { walletName: "Treasury", chainKind: 1, chainLabel: "Ethereum", ticker: "ETH", walletEthAddress: evm, amount: "0.000000000000000001", setAmount: noop, amountWei: 1n, recipient: "operations.eth", setRecipient: noop, recipientValid: true, effectiveRecipient: evm, ensName: "operations.eth", ensResolving: false, ensFailed: false, note: "", setNote: noop, amountValid: true, canSubmit: true, walletBalanceWei: 10000n, balanceLoading: false, insufficientBalance: false, gasReserveWei: 100n, approvalThreshold: 2, timelockSeconds: 0, onSubmit: noop, reduce: true }));
  expect(html).toContain(evm); expect(html).toContain("0.000000000000000001 ETH");
});
it("actual token review retains contract and full recipient", () => {
  const html = renderToStaticMarkup(createElement(TokenCompose, { walletName: "Treasury", walletEthAddress: evm, tokenContract: token, setTokenContract: noop, tokenContractValid: true, metadata: { decimals: 6, symbol: "USDC", name: "USD Coin" }, metadataLoading: false, metadataError: false, amount: "0.000001", setAmount: noop, amountBase: 1n, recipient: evm, setRecipient: noop, recipientValid: true, note: "", setNote: noop, amountValid: true, canSubmit: true, walletBalance: 10000n, balanceLoading: false, insufficientBalance: false, approvalThreshold: 2, timelockSeconds: 0, onSubmit: noop, reduce: true }));
  expect(html).toContain(token); expect(html).toContain(evm); expect(html).toContain("0.000001 USDC");
});
it("Bitcoin preview keeps complete destination and satoshi precision", () => {
  const destination = "tb1qabcdefghijklmnopqrstuvwxyz0123456789";
  const rows = buildBtcPreviewDetails({ walletDisplay: "Treasury", destination, amountBtc: "0.00000001", selectedUtxo: null, effectiveFeeSats: null, changeSats: null, note: "", approvalThreshold: 2, timelockSeconds: 0 });
  expect(rows).toContainEqual({ label: "Recipient address", value: destination, emphasis: "mono" });
  expect(rows.find(row => row.label === "Amount")?.value).toBe("0.00000001 BTC");
});
it("does not hide recipient, wallet-cap or velocity risks behind a chain-cap breach", () => {
  const warning = buildSendPreviewWarning({ resolved: { kind: "address", address }, pendingUsd: 10, budgetUsage: { ...usage, budget: { walletName: "Treasury", weeklyUsd: 10 } as never, spentUsd: 9, perChain: [{ ticker: "SOL", cap: 5, spentUsd: 4 } as never], velocityHit: true, sendsLast24h: 3 } });
  expect(warning).toContain("Solana"); expect(warning).toContain("Treasury"); expect(warning).toContain("3 times"); expect(warning).toContain("raw address"); expect(warning).not.toContain("cap is a guide");
});
