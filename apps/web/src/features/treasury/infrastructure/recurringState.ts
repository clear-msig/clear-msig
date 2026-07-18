import { Connection, PublicKey } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";

export interface OnchainRecurringSchedule {
  address: string;
  intent: string;
  recipient: string;
  amountLamports: bigint;
  intervalSeconds: number;
  nextExecutionAt: number;
  remainingPayments: number;
  executedPayments: number;
  status: "active" | "revoked" | "complete";
}

export async function fetchRecurringSchedule(
  connection: Connection,
  wallet: PublicKey,
  scheduleId: string,
): Promise<OnchainRecurringSchedule | null> {
  const scheduleHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scheduleId)),
  );
  const [address] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("recurring"), wallet.toBytes(), scheduleHash],
    CLEAR_WALLET_PROGRAM_ID,
  );
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account || !account.owner.equals(CLEAR_WALLET_PROGRAM_ID) || account.data.length < 833) {
    return null;
  }
  const data = account.data;
  if (data[0] !== 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const status = data[831];
  return {
    address: address.toBase58(),
    intent: new PublicKey(data.subarray(33, 65)).toBase58(),
    recipient: new PublicKey(data.subarray(97, 129)).toBase58(),
    amountLamports: view.getBigUint64(161, true),
    intervalSeconds: view.getUint32(169, true),
    nextExecutionAt: Number(view.getBigInt64(173, true)),
    remainingPayments: view.getUint32(181, true),
    executedPayments: view.getUint32(185, true),
    status: status === 1 ? "active" : status === 2 ? "revoked" : "complete",
  };
}
