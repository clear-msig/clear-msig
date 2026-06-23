import { IntentType } from "@/lib/msig";

export const BTC_CHANGE_PARAM_COUNT = 8;
export const BTC_CHAIN_KIND = 2;

export type BitcoinIntentCandidate = {
  intentType: number;
  chainKind: number;
  params: readonly unknown[];
};

export function selectBitcoinSendIntent<
  Intent extends BitcoinIntentCandidate | null | undefined,
>(intents: readonly Intent[]): NonNullable<Intent> | null {
  let best: NonNullable<Intent> | null = null;
  for (const intent of intents) {
    if (
      !intent ||
      intent.intentType !== IntentType.Custom ||
      intent.chainKind !== BTC_CHAIN_KIND
    ) {
      continue;
    }
    if (!best || intent.params.length > best.params.length) {
      best = intent as NonNullable<Intent>;
    }
  }
  return best;
}

export function bitcoinSendReady(
  intent: BitcoinIntentCandidate | null | undefined,
): boolean {
  return (intent?.params.length ?? 0) >= BTC_CHANGE_PARAM_COUNT;
}
