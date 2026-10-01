import { Connection, PublicKey } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";

export interface OnchainRecurringSchedule {
  address: string;
  intent: string;
  recipient: string;
  asset: "SOL" | "USDC";
  amountRaw: bigint;
  mint?: string;
  sourceToken?: string;
  destinationToken?: string;
  intervalSeconds: number;
  nextExecutionAt: number;
  remainingPayments: number;
  executedPayments: number;
  status: "active" | "revoked" | "complete";
  policyVersion: "CSP1" | "CSP2";
}

export async function fetchRecurringSchedule(
  connection: Connection,
  wallet: PublicKey,
  scheduleId: string,
): Promise<OnchainRecurringSchedule | null> {
  const expected = process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim();
  if (!expected || (await connection.getGenesisHash()) !== expected)
    throw new Error(
      "Recurring verification requires the pinned Solana genesis identity.",
    );
  const scheduleHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scheduleId)),
  );
  const [address, bump] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("recurring"), wallet.toBytes(), scheduleHash],
    CLEAR_WALLET_PROGRAM_ID,
  );
  const account = await connection.getAccountInfo(address, "finalized");
  if (!account) return null;
  const token = account.data[0] === 13;
  if (
    !account.owner.equals(CLEAR_WALLET_PROGRAM_ID) ||
    account.executable ||
    !new PublicKey(account.data.subarray(1, 33)).equals(wallet) ||
    !scheduleHash.every((byte, index) => account.data[65 + index] === byte) ||
    account.data[token ? 960 : 832] !== bump
  )
    throw new Error("Recurring schedule ownership or identity mismatch.");
  const parsed = parseRecurringScheduleAccount(
    address.toBase58(),
    account.data,
  );
  if (!parsed) throw new Error("Recurring schedule layout is unsupported.");
  return parsed;
}

export function parseRecurringScheduleAccount(
  address: string,
  data: Uint8Array,
): OnchainRecurringSchedule | null {
  if (data[0] !== 12 && data[0] !== 13) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const token = data[0] === 13;
  if (data.length < (token ? 961 : 833)) return null;
  const status = data[token ? 959 : 831];
  if (![1, 2, 3].includes(status)) return null;
  const policyOffset = token ? 319 : 191;
  const policyVersion = data[policyOffset + 3] === 0x32 ? "CSP2" : "CSP1";
  return {
    address,
    intent: new PublicKey(data.subarray(33, 65)).toBase58(),
    recipient: new PublicKey(data.subarray(97, 129)).toBase58(),
    asset: token ? "USDC" : "SOL",
    amountRaw: view.getBigUint64(token ? 289 : 161, true),
    mint: token ? new PublicKey(data.subarray(161, 193)).toBase58() : undefined,
    sourceToken: token
      ? new PublicKey(data.subarray(193, 225)).toBase58()
      : undefined,
    destinationToken: token
      ? new PublicKey(data.subarray(225, 257)).toBase58()
      : undefined,
    intervalSeconds: view.getUint32(token ? 297 : 169, true),
    nextExecutionAt: Number(view.getBigInt64(token ? 301 : 173, true)),
    remainingPayments: view.getUint32(token ? 309 : 181, true),
    executedPayments: view.getUint32(token ? 313 : 185, true),
    status: status === 1 ? "active" : status === 2 ? "revoked" : "complete",
    policyVersion,
  };
}
