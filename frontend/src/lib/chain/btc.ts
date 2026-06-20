"use client";

// Bitcoin chain helpers - symmetric to lib/chain/eth.ts.
//
// V1 covers tx-history reads via the public mempool.space Esplora
// API (no key, decent rate limit). The on-chain balance is already
// fetched in lib/balances/index.ts; this module is the "list
// recent txs for an address" surface needed by the dashboard
// activity section.
//
// Address format determines mainnet vs testnet:
//   mainnet:   bc1q... / bc1p... / 1... / 3...
//   testnet:   tb1q... / m... / n... / 2...
// We sniff the prefix and pick the right Esplora subpath. If a
// future binding produces signet (tb1q on signet) the fallback
// "testnet" works against signet too via the same API.

export interface BtcTxRow {
  /// Bitcoin txid (hex, no 0x prefix).
  txId: string;
  /// Unix seconds. Mempool-only (unconfirmed) txs return null;
  /// callers should treat that as "pending".
  blockTime: number | null;
  blockHeight: number | null;
  /// True when the tx is in a block (any confirmation count).
  /// Esplora's "status.confirmed" field maps directly.
  confirmed: boolean;
  /// Net value to the queried address, in satoshis. Positive =
  /// the address received this much (sum of vout matching) net of
  /// any spends in vin from the same address. Esplora doesn't
  /// expose this directly so we compute it client-side.
  netValueSats: bigint;
}

/// Fetch recent on-chain Bitcoin txs for an address. Returns up
/// to `limit` rows, newest first. mempool.space returns up to 50
/// confirmed txs per page; we cap at the caller's limit.
export async function fetchBitcoinTxHistory(
  address: string,
  limit: number = 10,
): Promise<BtcTxRow[]> {
  const isTestnet = isLikelyBitcoinTestnetAddress(address);
  const base = isTestnet
    ? "https://mempool.space/testnet/api"
    : "https://mempool.space/api";
  if (esploraBaseUrl(isTestnet ? "testnet" : "mainnet").includes(".g.alchemy.com/")) {
    return fetchAlchemyBitcoinTxHistory(address, isTestnet ? "testnet" : "mainnet", limit);
  }
  const res = await fetch(`${base}/address/${address}/txs`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`mempool.space returned HTTP ${res.status}`);
  }
  type EsploraTx = {
    txid: string;
    status?: { confirmed?: boolean; block_height?: number; block_time?: number };
    vin?: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
    vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
  };
  const txs = (await res.json()) as EsploraTx[];
  const rows: BtcTxRow[] = [];
  for (const tx of txs.slice(0, limit)) {
    const confirmed = !!tx.status?.confirmed;
    const blockTime =
      typeof tx.status?.block_time === "number" ? tx.status.block_time : null;
    const blockHeight =
      typeof tx.status?.block_height === "number"
        ? tx.status.block_height
        : null;

    let netSats = 0n;
    for (const vout of tx.vout ?? []) {
      if (
        typeof vout.value === "number" &&
        typeof vout.scriptpubkey_address === "string" &&
        vout.scriptpubkey_address === address
      ) {
        netSats += BigInt(vout.value);
      }
    }
    for (const vin of tx.vin ?? []) {
      if (
        typeof vin.prevout?.value === "number" &&
        typeof vin.prevout?.scriptpubkey_address === "string" &&
        vin.prevout.scriptpubkey_address === address
      ) {
        netSats -= BigInt(vin.prevout.value);
      }
    }

    rows.push({
      txId: tx.txid,
      blockTime,
      blockHeight,
      confirmed,
      netValueSats: netSats,
    });
  }
  return rows;
}

async function fetchAlchemyBitcoinTxHistory(
  address: string,
  network: BitcoinNetwork,
  limit: number,
): Promise<BtcTxRow[]> {
  const rpcBase = esploraBaseUrl(network).replace(/\/+$/, "");
  const addressUrl = `${rpcBase}/api/v2/address/${encodeURIComponent(address)}?details=txids`;
  const resp = await fetch(addressUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
  });
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Alchemy Bitcoin address HTTP ${resp.status}`);
  }
  const raw = (await resp.json()) as unknown;
  const txids = extractTxids(raw).slice(0, limit);
  const rows: BtcTxRow[] = [];
  for (const txid of txids) {
    const tx = await bitcoinRpcCall(network, "getrawtransaction", [txid, true]);
    const rec = tx.result as Record<string, unknown> | undefined;
    if (!rec) continue;
    const confirmations = numberField(rec, "confirmations");
    const blockTime = numberField(rec, "blocktime", "time");
    const blockHeight = numberField(rec, "blockheight", "height");
    rows.push({
      txId: txid,
      blockTime: blockTime ?? null,
      blockHeight: blockHeight ?? null,
      confirmed: (confirmations ?? 0) > 0,
      netValueSats: 0n,
    });
  }
  return rows;
}

async function bitcoinRpcCall(
  network: BitcoinNetwork,
  method: string,
  params: unknown[],
): Promise<{ result?: unknown; error?: { message?: string } }> {
  const rpcBase = esploraBaseUrl(network).replace(/\/+$/, "");
  const resp = await fetch(rpcBase, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Bitcoin RPC returned HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(`Bitcoin RPC error: ${json.error.message ?? "unknown"}`);
  }
  return json;
}

function extractTxids(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) =>
      typeof item === "string"
        ? [item]
        : typeof item === "object" && item !== null
          ? extractTxidsFromObject(item as Record<string, unknown>)
          : [],
    );
  }
  if (typeof raw === "object" && raw !== null) {
    return extractTxidsFromObject(raw as Record<string, unknown>);
  }
  return [];
}

function extractTxidsFromObject(obj: Record<string, unknown>): string[] {
  for (const key of ["txids", "transactions", "txid_list", "txidList"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string" && x.length > 0);
    }
  }
  return [];
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

function isLikelyBitcoinTestnetAddress(addr: string): boolean {
  const s = addr.toLowerCase();
  if (s.startsWith("tb1") || s.startsWith("tb1q") || s.startsWith("tb1p")) {
    return true;
  }
  // Legacy testnet starts with m / n / 2 - but mainnet legacy starts
  // with 1 / 3 (P2PKH / P2SH). Bech32 is the discriminator we trust;
  // if the bech32 check above missed, leave it as mainnet.
  if (s.startsWith("m") || s.startsWith("n") || s.startsWith("2")) {
    return true;
  }
  return false;
}

// ─── Network targeting ────────────────────────────────────────────

export type BitcoinNetwork = "mainnet" | "testnet" | "signet" | "regtest";

const BITCOIN_MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_BITCOIN_MAINNET_RPC_URL ?? null;
const BITCOIN_TESTNET_RPC_URL =
  process.env.NEXT_PUBLIC_BITCOIN_TESTNET_RPC_URL ?? null;
const BITCOIN_SIGNET_RPC_URL =
  process.env.NEXT_PUBLIC_BITCOIN_SIGNET_RPC_URL ?? null;

/// Default network for v1. **testnet3**.
///
/// We previously defaulted to signet (free faucets, stable fees) but
/// the wider faucet ecosystem in 2026 still leans testnet3, so users
/// who hit "Get testnet BTC" from any of the canonical faucets land
/// on testnet3 by default. The on-chain BIP143 preimage builder
/// (`programs/clear-wallet/src/chains/bitcoin.rs`) is network-agnostic
///. It just hashes raw bytes. So the network choice is purely a
/// matter of which Esplora endpoint we read from / broadcast to.
///
/// Note that `tb1q...` addresses are valid on BOTH testnet3 and
/// signet (they share the bech32 HRP). `validateBtcDestination`
/// collapses the ambiguity.
export const DEFAULT_BITCOIN_NETWORK: BitcoinNetwork = "testnet";

/// Bitcoin RPC / Esplora base URL per network. If an Alchemy Bitcoin
/// endpoint is configured for the selected network, return that.
/// Otherwise fall back to the public mempool.space Esplora endpoint.
export function esploraBaseUrl(network: BitcoinNetwork): string {
  switch (network) {
    case "mainnet":
      return BITCOIN_MAINNET_RPC_URL ?? "https://mempool.space/api";
    case "testnet":
      return BITCOIN_TESTNET_RPC_URL ?? "https://mempool.space/testnet/api";
    case "signet":
      return BITCOIN_SIGNET_RPC_URL ?? "https://mempool.space/signet/api";
    case "regtest":
      // No public regtest Esplora; user is expected to override via
      // env. Returning a placeholder keeps the type exhaustive.
      return "http://localhost:3002";
  }
}

function bitcoinExplorerBaseUrl(network: BitcoinNetwork): string {
  switch (network) {
    case "mainnet":
      return "https://mempool.space";
    case "testnet":
      return "https://mempool.space/testnet";
    case "signet":
      return "https://mempool.space/signet";
    case "regtest":
      return "http://localhost:3002";
  }
}

export function bitcoinExplorerLabel(network: BitcoinNetwork): string {
  switch (network) {
    case "mainnet":
      return "mempool.space";
    case "testnet":
      return "mempool.space testnet";
    case "signet":
      return "mempool.space";
    case "regtest":
      return "Bitcoin explorer";
  }
}

export function mempoolSpaceTxUrl(
  txid: string,
  network: BitcoinNetwork,
): string {
  return `${bitcoinExplorerBaseUrl(network)}/tx/${txid}`;
}

export function mempoolSpaceAddressUrl(
  address: string,
  network: BitcoinNetwork,
): string {
  return `${bitcoinExplorerBaseUrl(network)}/address/${address}`;
}

/**
 * Probe testnet3 + signet to find which one actually has UTXOs for
 * the dWallet's address. The two share the bech32 `tb` HRP so we
 * can't tell from the address alone which faucet the user hit.
 *
 * Strategy:
 *   1. Probe testnet3 first (broader faucet ecosystem in 2026).
 *   2. If `funded_txo_count > 0` there, return "testnet".
 *   3. Otherwise probe signet. If that has UTXOs, return "signet".
 *   4. If both are empty (fresh wallet), return "testnet". The
 *      Receive page's tb-HRP address is fundable by any tb faucet,
 *      so testnet is the safer default for "next step is fund me".
 *
 * Mainnet `bc` HRP short-circuits before probing. Only here for
 * type completeness; `chainAddress` already filters out mainnet
 * addresses in pre-alpha.
 */
export async function detectBitcoinNetwork(
  address: string,
): Promise<BitcoinNetwork> {
  if (!address) return DEFAULT_BITCOIN_NETWORK;
  const lower = address.toLowerCase();
  if (lower.startsWith("bc1")) return "mainnet";
  if (lower.startsWith("bcrt1")) return "regtest";
  if (!lower.startsWith("tb1")) return DEFAULT_BITCOIN_NETWORK;

  const probes: BitcoinNetwork[] = ["testnet", "signet"];
  for (const net of probes) {
    try {
      const url = `${esploraBaseUrl(net)}/address/${encodeURIComponent(address)}`;
      const r = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
      });
      if (!r.ok) continue;
      const j = (await r.json()) as {
        chain_stats?: { funded_txo_count?: number };
        mempool_stats?: { funded_txo_count?: number };
      };
      const funded =
        (j.chain_stats?.funded_txo_count ?? 0) +
        (j.mempool_stats?.funded_txo_count ?? 0);
      if (funded > 0) return net;
    } catch {
      // ignore network errors; try the next probe
    }
  }
  return DEFAULT_BITCOIN_NETWORK;
}

// ─── Esplora. Balance + UTXOs ────────────────────────────────────

export interface EsploraUtxo {
  txid: string;
  vout: number;
  /** Confirmed value in satoshis. */
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export interface BitcoinAddressSnapshot {
  network: BitcoinNetwork;
  balanceSats: bigint;
  utxos: EsploraUtxo[];
}

/**
 * Read balance + UTXOs together and pick the funded network for tb1...
 * addresses. Testnet3 and signet share the `tb` HRP, so a separate
 * "detect network" call can race or pick the empty side. This helper
 * keeps the send page honest: whichever testnet-class endpoint sees
 * funds becomes the active balance/UTXO source.
 */
export async function fetchBitcoinAddressSnapshot(
  address: string,
): Promise<BitcoinAddressSnapshot> {
  if (!address) {
    return {
      network: DEFAULT_BITCOIN_NETWORK,
      balanceSats: 0n,
      utxos: [],
    };
  }

  const lower = address.toLowerCase();
  if (lower.startsWith("bc1")) {
    return fetchBitcoinAddressSnapshotForNetwork(address, "mainnet");
  }
  if (lower.startsWith("bcrt1")) {
    return fetchBitcoinAddressSnapshotForNetwork(address, "regtest");
  }
  if (!lower.startsWith("tb1")) {
    return fetchBitcoinAddressSnapshotForNetwork(
      address,
      DEFAULT_BITCOIN_NETWORK,
    );
  }

  const networks: BitcoinNetwork[] = ["testnet", "signet"];
  const settled = await Promise.allSettled(
    networks.map((network) =>
      fetchBitcoinAddressSnapshotForNetwork(address, network),
    ),
  );
  const fulfilled = settled
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((result): result is BitcoinAddressSnapshot => result !== null);

  const funded = fulfilled.find(
    (snapshot) => snapshot.balanceSats > 0n || snapshot.utxos.length > 0,
  );
  if (funded) return funded;
  const preferred = fulfilled.find(
    (snapshot) => snapshot.network === DEFAULT_BITCOIN_NETWORK,
  );
  if (preferred) return preferred;
  if (fulfilled[0]) return fulfilled[0];

  const reasons = settled
    .map((result) =>
      result.status === "rejected"
        ? result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
        : null,
    )
    .filter((reason): reason is string => !!reason);
  throw new Error(
    reasons.length
      ? `Bitcoin indexers unavailable: ${reasons.join("; ")}`
      : "Bitcoin indexers unavailable",
  );
}

async function fetchBitcoinAddressSnapshotForNetwork(
  address: string,
  network: BitcoinNetwork,
): Promise<BitcoinAddressSnapshot> {
  const [balanceSats, utxos] = await Promise.all([
    fetchBitcoinBalance(address, network),
    fetchBitcoinUtxos(address, network),
  ]);
  return { network, balanceSats, utxos };
}

/**
 * Confirmed + mempool balance in satoshis for a Bitcoin address.
 * Returns 0 for fresh addresses Esplora doesn't recognise.
 */
export async function fetchBitcoinBalance(
  address: string,
  network: BitcoinNetwork = DEFAULT_BITCOIN_NETWORK,
): Promise<bigint> {
  const rpcBase = esploraBaseUrl(network);
  if (rpcBase.includes(".g.alchemy.com/")) {
    const utxos = await fetchBitcoinUtxos(address, network);
    return utxos.reduce((acc, utxo) => acc + BigInt(utxo.value), 0n);
  }
  const url = `${rpcBase}/address/${encodeURIComponent(address)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
  });
  if (!resp.ok) {
    if (resp.status === 404) return 0n;
    throw new Error(`Esplora HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const chain =
    BigInt(json.chain_stats?.funded_txo_sum ?? 0) -
    BigInt(json.chain_stats?.spent_txo_sum ?? 0);
  const mempool =
    BigInt(json.mempool_stats?.funded_txo_sum ?? 0) -
    BigInt(json.mempool_stats?.spent_txo_sum ?? 0);
  const total = chain + mempool;
  return total < 0n ? 0n : total;
}

/**
 * UTXO list for an address, sorted descending by value (so callers
 * doing largest-first selection don't re-sort). Mixes confirmed +
 * mempool inputs; the caller decides whether to allow unconfirmed.
 */
export async function fetchBitcoinUtxos(
  address: string,
  network: BitcoinNetwork = DEFAULT_BITCOIN_NETWORK,
): Promise<EsploraUtxo[]> {
  const rpcBase = esploraBaseUrl(network);
  if (rpcBase.includes(".g.alchemy.com/")) {
    const base = rpcBase.replace(/\/+$/, "");
    const url = `${base}/api/v2/utxo/${encodeURIComponent(address)}?confirmed=false`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
    });
    if (!resp.ok) {
      if (resp.status === 404) return [];
      throw new Error(`Alchemy Bitcoin UTXO HTTP ${resp.status}`);
    }
    const raw = (await resp.json()) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { utxos?: unknown[] })?.utxos)
        ? ((raw as { utxos?: unknown[] }).utxos as unknown[])
        : [];
    return list
      .map((row) => {
        const rec = row as Record<string, unknown>;
        const txid = typeof rec.txid === "string" ? rec.txid : "";
        const vout =
          typeof rec.vout === "number"
            ? rec.vout
            : typeof rec.vout === "string"
              ? parseInt(rec.vout, 10)
              : NaN;
        const value =
          typeof rec.value === "number"
            ? rec.value
            : typeof rec.value === "string"
              ? parseInt(rec.value, 10)
              : NaN;
        const confirmed =
          typeof rec.confirmed === "boolean"
            ? rec.confirmed
            : typeof rec.confirmations === "number"
              ? rec.confirmations > 0
              : typeof rec.confirmations === "string"
                ? parseInt(rec.confirmations, 10) > 0
                : false;
        const blockHeight =
          typeof rec.height === "number"
            ? rec.height
            : typeof rec.height === "string"
              ? parseInt(rec.height, 10)
              : undefined;
        const blockTime =
          typeof rec.block_time === "number"
            ? rec.block_time
            : typeof rec.blockTime === "number"
              ? rec.blockTime
              : undefined;
        if (!txid || !Number.isFinite(vout) || !Number.isFinite(value)) {
          return null;
        }
        return {
          txid,
          vout,
          value,
          status: {
            confirmed,
            block_height: Number.isFinite(blockHeight) ? blockHeight : undefined,
            block_time: Number.isFinite(blockTime) ? blockTime : undefined,
          },
        } as EsploraUtxo;
      })
      .filter((row): row is EsploraUtxo => row !== null)
      .sort((a, b) => b.value - a.value);
  }
  const url = `${rpcBase}/address/${encodeURIComponent(address)}/utxo`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "omit",
  });
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`Esplora HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as EsploraUtxo[];
  return [...json].sort((a, b) => b.value - a.value);
}

// ─── bech32 decode (BIP173 / BIP350 segwit v0 / v1) ───────────────
//
// V1 send flow needs to decode the destination bech32 address into
// its 20-byte pkh for the intent's `recipient_pkh` param. Pure JS
// reference implementation; we also use it for client-side
// validation (typo guard) before submitting an intent.

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATOR[i]!;
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function verifyBech32Checksum(
  hrp: string,
  data: number[],
  spec: "bech32" | "bech32m",
): boolean {
  const target = spec === "bech32" ? 1 : 0x2bc830a3;
  return bech32Polymod([...bech32HrpExpand(hrp), ...data]) === target;
}

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const v of data) {
    if (v < 0 || v >> fromBits !== 0) return null;
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null;
  }
  return Uint8Array.from(out);
}

export interface DecodedSegwit {
  hrp: string;
  /** 0 for P2WPKH/P2WSH; 1+ for taproot. v1 send rejects non-zero. */
  version: number;
  /** Witness program. 20 bytes for P2WPKH, 32 bytes for P2WSH/taproot. */
  program: Uint8Array;
}

/// Decode a segwit bech32(m) address. Returns null on invalid format,
/// bad checksum, mixed case, or unsupported witness program length.
export function decodeSegwitAddress(addr: string): DecodedSegwit | null {
  if (typeof addr !== "string") return null;
  if (addr.length < 8 || addr.length > 90) return null;
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return null;
  const lower = addr.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return null;
  const hrp = lower.slice(0, sep);
  const dataPart = lower.slice(sep + 1);
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) return null;
  }
  const data: number[] = [];
  for (let i = 0; i < dataPart.length; i++) {
    const idx = BECH32_CHARSET.indexOf(dataPart[i]!);
    if (idx === -1) return null;
    data.push(idx);
  }
  if (data.length < 7) return null;
  const version = data[0]!;
  const isV0 = version === 0;
  const ok =
    (isV0 && verifyBech32Checksum(hrp, data, "bech32")) ||
    (!isV0 && verifyBech32Checksum(hrp, data, "bech32m"));
  if (!ok) return null;
  const fiveBits = data.slice(1, data.length - 6);
  const program = convertBits(fiveBits, 5, 8, false);
  if (!program) return null;
  if (program.length < 2 || program.length > 40) return null;
  return { hrp, version, program };
}

export function networkForHrp(hrp: string): BitcoinNetwork | null {
  switch (hrp.toLowerCase()) {
    case "bc":
      return "mainnet";
    case "tb":
      // tb is shared between testnet3 and signet; collapse to the
      // pre-alpha default. `validateBtcDestination` accepts the other
      // direction too via its symmetric tb-HRP fallback.
      return "testnet";
    case "bcrt":
      return "regtest";
    default:
      return null;
  }
}

export type ValidateBtcResult =
  | { ok: true; pkh: Uint8Array; network: BitcoinNetwork }
  | { ok: false; reason: string };

/**
 * Validate a destination address against the wallet's network. On
 * success returns the 20-byte pkh ready to feed into the BTC intent's
 * `recipient_pkh` param. Refuses non-v0 (no taproot output yet. The
 * on-chain program only knows P2WPKH).
 */
export function validateBtcDestination(
  address: string,
  expectedNetwork: BitcoinNetwork,
): ValidateBtcResult {
  const trimmed = address.trim();
  if (!trimmed) {
    return { ok: false, reason: "Enter a Bitcoin address." };
  }
  const decoded = decodeSegwitAddress(trimmed);
  if (!decoded) {
    return {
      ok: false,
      reason: "Invalid bech32 address. Check for typos or copy-paste errors.",
    };
  }
  if (decoded.version !== 0) {
    return {
      ok: false,
      reason: "Only segwit v0 (P2WPKH) destinations are supported.",
    };
  }
  if (decoded.program.length !== 20) {
    return {
      ok: false,
      reason: `Expected a 20-byte P2WPKH address; got a ${decoded.program.length}-byte witness program (P2WSH or taproot is unsupported).`,
    };
  }
  const detected = networkForHrp(decoded.hrp);
  if (!detected) {
    return {
      ok: false,
      reason: `Unrecognised bech32 prefix "${decoded.hrp}".`,
    };
  }
  // tb covers both testnet + signet; treat as compatible.
  const same =
    detected === expectedNetwork ||
    (detected === "signet" && expectedNetwork === "testnet") ||
    (detected === "testnet" && expectedNetwork === "signet");
  if (!same) {
    return {
      ok: false,
      reason: `Address is ${detected} but this wallet is bound to ${expectedNetwork}.`,
    };
  }
  return { ok: true, pkh: decoded.program, network: detected };
}

// ─── Format helpers ───────────────────────────────────────────────

export const SATS_PER_BTC = 100_000_000n;

export function formatSats(sats: bigint): string {
  if (sats === 0n) return "0";
  const whole = sats / SATS_PER_BTC;
  const frac = sats % SATS_PER_BTC;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Reverse a hex string byte-by-byte. Used to flip a Bitcoin txid
 * between display order (Esplora's response, what block explorers
 * show) and internal byte order (what BIP143 / wire format expects).
 * Asserts even length so a mistyped odd-length hex doesn't silently
 * slice off a nibble.
 */
export function reverseHex(hex: string): string {
  if (hex.length % 2 !== 0) {
    throw new Error(`reverseHex: odd-length hex (${hex.length} chars)`);
  }
  const out: string[] = [];
  for (let i = hex.length; i > 0; i -= 2) {
    out.push(hex.slice(i - 2, i));
  }
  return out.join("");
}

/**
 * Parse a user-entered BTC amount (e.g. "0.001", "0.5") to sats.
 * Returns null on malformed input or zero/negative values.
 */
export function parseBtcAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{0,8})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  try {
    const w = BigInt(whole ?? "0");
    const f = BigInt(fracPadded || "0");
    const v = w * SATS_PER_BTC + f;
    if (v <= 0n) return null;
    return v;
  } catch {
    return null;
  }
}
