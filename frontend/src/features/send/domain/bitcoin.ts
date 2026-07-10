import { decodeSegwitAddress } from "@/lib/chain/btc";
import { BTC_CHAIN_KIND, bitcoinSendReady } from "@/lib/chain/btcIntentReadiness";
import { pkhClearSignRecipient } from "@/lib/clearsign-v2";
import { fromHex, parseIntent } from "@/lib/msig";

export function assertPreparedBitcoinSetupIsCurrent(paramsDataHex: string) {
  let preparedParams = 0;
  try {
    const body = fromHex(paramsDataHex);
    const accountData = new Uint8Array(body.length + 1);
    accountData[0] = 2;
    accountData.set(body, 1);
    const intent = parseIntent(accountData);
    preparedParams = intent.params.length;
    if (intent.chainKind === BTC_CHAIN_KIND && bitcoinSendReady(intent)) return;
  } catch (error) {
    throw new Error(
      `Bitcoin sending could not be prepared right now. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  throw new Error(
    preparedParams > 0
      ? "Bitcoin sending needs a one-time update. Tap Turn on Bitcoin sending once, then wait for it to finish."
      : "Bitcoin sending needs to be turned on before sending BTC.",
  );
}

export function bytesToHex(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index++) {
    value += (bytes[index] ?? 0).toString(16).padStart(2, "0");
  }
  return value;
}

export function normalizeBitcoinPolicyRecipient(value: string): string {
  const decoded = decodeSegwitAddress(value);
  return decoded && decoded.version === 0 && decoded.program.length === 20
    ? pkhClearSignRecipient("btc-p2wpkh", decoded.program)
    : value.trim();
}
