import type { BlockheightBasedTransactionConfirmationStrategy, Connection } from "@solana/web3.js";

// RPC confirmation can resolve successfully while reporting a failed onchain
// transaction in value.err. Never advance recovery state on that response.
export async function confirmSuccessfulTransaction(
  connection: Connection,
  strategy: BlockheightBasedTransactionConfirmationStrategy,
): Promise<void> {
  const result = await connection.confirmTransaction(strategy, "confirmed");
  if (!result?.value || result.value.err === undefined) {
    throw new Error(`Transaction ${strategy.signature} has no verified confirmation status. Check its status before retrying.`);
  }
  if (result.value.err !== null) {
    throw new Error(`Transaction ${strategy.signature} failed on chain: ${JSON.stringify(result.value.err)}`);
  }
}
