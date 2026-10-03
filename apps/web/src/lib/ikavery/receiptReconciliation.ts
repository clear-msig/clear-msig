import type { Connection } from "@solana/web3.js";
import type { ReceiptStore } from "./transactionOperation";

/** Status lookup is asynchronous; only merge into the store's latest contents. */
export async function checkSecureReceipts(
  connection: Connection,
  signer: string | undefined,
  store: ReceiptStore,
  assertCurrent: () => void,
): Promise<void> {
  const genesis = await connection.getGenesisHash();
  assertCurrent();
  const requested = store.read().filter(r => r.signer === signer && r.genesis === genesis);
  if (!requested.length) throw new Error("These transactions belong to another network. Switch to the original network to check them.");
  const { value } = await connection.getSignatureStatuses(requested.map(r => r.signature), {searchTransactionHistory: true});
  assertCurrent();
  // Do not resurrect removed receipts, discard new steps, overwrite current
  // metadata, or regress an outcome recorded while the RPC request was pending.
  const fresh = store.read();
  store.write(fresh.map(receipt => {
    if (receipt.status !== "unknown") return receipt;
    const index = requested.findIndex(r => r.signature === receipt.signature && r.genesis === receipt.genesis && r.signer === receipt.signer && r.operation === receipt.operation);
    const status = index < 0 ? undefined : value[index];
    if (status?.confirmationStatus !== "confirmed" && status?.confirmationStatus !== "finalized") return receipt;
    return {...receipt, status: status.err ? "failed" : "confirmed"};
  }));
}
