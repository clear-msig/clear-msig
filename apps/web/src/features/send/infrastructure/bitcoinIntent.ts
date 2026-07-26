import { bitcoinSendReady, selectBitcoinSendIntent } from "@/lib/chain/btcIntentReadiness";
import { listIntents } from "@/lib/chain/intents";
import { fetchWalletByName } from "@/lib/chain/wallets";

export async function waitForBitcoinChangeIntent(
  connection: Parameters<typeof fetchWalletByName>[0],
  walletName: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await hasBitcoinChangeIntent(connection, walletName)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return false;
}

export async function hasBitcoinChangeIntent(
  connection: Parameters<typeof fetchWalletByName>[0],
  walletName: string,
): Promise<boolean> {
  try {
    const wallet = await fetchWalletByName(connection, walletName);
    if (!wallet) return false;
    const intents = await listIntents(connection, wallet.pda, wallet.account.intentIndex);
    return bitcoinSendReady(selectBitcoinSendIntent(intents.map((intent) => intent.account)));
  } catch {
    return false;
  }
}
