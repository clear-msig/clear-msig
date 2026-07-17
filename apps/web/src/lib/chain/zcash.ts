"use client";

import bs58 from "bs58";
import { sha256 } from "@noble/hashes/sha2";

const ZEC_MAINNET_VERSION = Uint8Array.from([0x1c, 0xb8]);
const ZEC_TESTNET_VERSION = Uint8Array.from([0x1d, 0x25]);

export type ZcashNetwork = "mainnet" | "testnet";

export interface ZcashTransparentAddress {
  network: ZcashNetwork;
  /// 20-byte HASH160 payload for a transparent P2PKH address.
  pkh: Uint8Array;
}

export interface ZcashUtxo {
  txid: string;
  vout: number;
  satoshis: bigint;
  height: number | null;
}

export const ZCASH_SEND_FEE_RESERVE_ZATS = 1000n;

export interface ZcashSendSelection {
  utxo: ZcashUtxo;
  impliedFeeZats: bigint;
  feeBurnRisk: boolean;
}

export function selectZcashNoChangeUtxo(
  utxos: readonly ZcashUtxo[],
  amountZats: bigint,
  feeZats: bigint = ZCASH_SEND_FEE_RESERVE_ZATS,
): ZcashSendSelection | null {
  if (amountZats <= 0n || feeZats < 0n) return null;
  const needed = amountZats + feeZats;
  const utxo = [...utxos]
    .sort((a, b) =>
      a.satoshis === b.satoshis ? 0 : a.satoshis < b.satoshis ? -1 : 1,
    )
    .find((candidate) => candidate.satoshis >= needed);
  if (!utxo) return null;
  const impliedFeeZats = utxo.satoshis - amountZats;
  return {
    utxo,
    impliedFeeZats,
    feeBurnRisk: impliedFeeZats !== feeZats,
  };
}

export interface ZcashTxRow {
  txId: string;
  blockTime: number | null;
  blockHeight: number | null;
  confirmed: boolean;
}

export function decodeZcashTransparentAddress(
  address: string,
): ZcashTransparentAddress | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(trimmed);
  } catch {
    return null;
  }
  if (decoded.length !== 26) return null;
  const payload = decoded.slice(0, 22);
  const checksum = decoded.slice(22);
  const version = payload.slice(0, 2);
  const pkh = payload.slice(2);
  if (pkh.length !== 20) return null;
  if (!equalsBytes(version, ZEC_MAINNET_VERSION) && !equalsBytes(version, ZEC_TESTNET_VERSION)) {
    return null;
  }
  const expected = doubleSha256(payload).slice(0, 4);
  if (!equalsBytes(checksum, expected)) return null;
  return {
    network: equalsBytes(version, ZEC_MAINNET_VERSION) ? "mainnet" : "testnet",
    pkh,
  };
}

export function validateZcashDestination(address: string): {
  ok: true;
  network: ZcashNetwork;
  pkh: Uint8Array;
} | {
  ok: false;
  reason: string;
} {
  const decoded = decodeZcashTransparentAddress(address);
  if (!decoded) {
    return {
      ok: false,
      reason: "Enter a valid transparent Zcash address.",
    };
  }
  return { ok: true, ...decoded };
}

export async function fetchZcashUtxos(
  rpcUrl: string,
  address: string,
): Promise<ZcashUtxo[]> {
  const res = await postZcashRpc(rpcUrl, "getaddressutxos", [
    { addresses: [address] },
  ]);
  const rows = Array.isArray(res.result) ? res.result : [];
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>;
      const txid = stringField(rec, "txid");
      const vout = numberField(rec, "vout", "outputIndex");
      const satoshis = bigintField(rec, "satoshis");
      const height = optionalNumberField(rec, "height");
      if (!txid || vout === null || satoshis === null) return null;
      return { txid, vout, satoshis, height };
    })
    .filter((row): row is ZcashUtxo => row !== null)
    .sort((a, b) => {
      if (a.satoshis === b.satoshis) return 0;
      return a.satoshis > b.satoshis ? -1 : 1;
    });
}

export async function fetchZcashBalance(
  rpcUrl: string,
  address: string,
): Promise<bigint> {
  const utxos = await fetchZcashUtxos(rpcUrl, address);
  return utxos.reduce((acc, u) => acc + u.satoshis, 0n);
}

export async function fetchZcashTxHistory(
  rpcUrl: string,
  address: string,
  limit: number = 10,
): Promise<ZcashTxRow[]> {
  const res = await postZcashRpc(rpcUrl, "getaddresstxids", [
    { addresses: [address] },
  ]);
  const txids = Array.isArray(res.result) ? res.result : [];
  const rows: ZcashTxRow[] = [];
  for (const txid of txids.slice(0, limit)) {
    if (typeof txid !== "string" || txid.length === 0) continue;
    const tx = await postZcashRpc(rpcUrl, "gettransaction", [txid]);
    const rec = (tx.result ?? {}) as Record<string, unknown>;
    const blockTime = numberField(rec, "blocktime", "time");
    const blockHeight = numberField(rec, "blockheight");
    const confirmations = numberField(rec, "confirmations");
    rows.push({
      txId: txid,
      blockTime: blockTime ?? null,
      blockHeight: blockHeight ?? null,
      confirmed: (confirmations ?? 0) > 0,
    });
  }
  return rows;
}

export function networkForZcashAddress(address: string): ZcashNetwork | null {
  return decodeZcashTransparentAddress(address)?.network ?? null;
}

async function postZcashRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<{ result?: unknown; error?: { message?: string } }> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`Zcash RPC returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(`Zcash RPC error: ${json.error.message ?? "unknown"}`);
  }
  return json;
}

function equalsBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

function stringField(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function numberField(
  row: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function optionalNumberField(
  row: Record<string, unknown>,
  ...keys: string[]
): number | null {
  return numberField(row, ...keys);
}

function bigintField(row: Record<string, unknown>, ...keys: string[]): bigint | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") {
      try {
        return BigInt(v);
      } catch {
        // ignore
      }
    }
  }
  return null;
}
