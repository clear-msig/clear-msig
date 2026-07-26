import type { Connection, PublicKey } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";
import { findAgentRiskAddress, fromHex, toHex } from "@/lib/msig";
import { hashAgentText } from "@/lib/agents/agentClearSignEncoding";

const DISCRIMINATOR = 10;
const ACCOUNT_LEN = 187;

export interface AgentRiskLedgerAccount {
  pda: PublicKey;
  wallet: PublicKey;
  sessionIdHash: string;
  oraclePolicyHash: string;
  maxLossRaw: bigint;
  realizedLossRaw: bigint;
  openNotionalRaw: bigint;
  nextSettlementSequence: bigint;
  lastSettlementArtifactHash: string;
  status: "active" | "paused";
}

export async function fetchAgentRiskLedger(
  connection: Connection,
  wallet: PublicKey,
  sessionId: string,
): Promise<AgentRiskLedgerAccount | null> {
  const sessionIdHash = hashAgentText(sessionId);
  const [pda] = findAgentRiskAddress(
    wallet,
    fromHex(sessionIdHash),
    CLEAR_WALLET_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(pda, DEFAULT_COMMITMENT);
  if (!info) return null;
  if (!info.owner.equals(CLEAR_WALLET_PROGRAM_ID)) {
    throw new Error("Agent risk ledger is not owned by the ClearSig program.");
  }
  return parseAgentRiskLedger(new Uint8Array(info.data), pda, wallet, sessionIdHash);
}

export function parseAgentRiskLedger(
  data: Uint8Array,
  pda: PublicKey,
  expectedWallet: PublicKey,
  expectedSessionIdHash: string,
): AgentRiskLedgerAccount {
  if (data.length < ACCOUNT_LEN || data[0] !== DISCRIMINATOR) {
    throw new Error("Agent risk ledger data is invalid.");
  }
  const walletBytes = data.slice(1, 33);
  const sessionBytes = data.slice(33, 65);
  if (!bytesEqual(walletBytes, expectedWallet.toBytes()) || toHex(sessionBytes) !== expectedSessionIdHash) {
    throw new Error("Agent risk ledger identity does not match this session.");
  }
  return {
    pda,
    wallet: expectedWallet,
    sessionIdHash: toHex(sessionBytes),
    oraclePolicyHash: toHex(data.slice(65, 97)),
    maxLossRaw: readU128Le(data, 97),
    realizedLossRaw: readU128Le(data, 113),
    openNotionalRaw: readU128Le(data, 129),
    nextSettlementSequence: readU64Le(data, 145),
    lastSettlementArtifactHash: toHex(data.slice(153, 185)),
    status: data[185] === 1 ? "active" : "paused",
  };
}

function readU64Le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

function readU128Le(data: Uint8Array, offset: number): bigint {
  return readU64Le(data, offset) | (readU64Le(data, offset + 8) << 64n);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
