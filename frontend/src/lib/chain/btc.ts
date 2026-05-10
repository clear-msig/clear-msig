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

/// Default network for v1 — signet has free faucets, stable fees,
/// and the on-chain `programs/clear-wallet/src/chains/bitcoin.rs`
/// is most-tested against it.
export const DEFAULT_BITCOIN_NETWORK: BitcoinNetwork = "signet";

/// mempool.space's Esplora base URL per network. Matches the CLI's
/// default in `cli/src/chains/bitcoin.rs` so a tx broadcast via the
/// CLI is visible to the frontend's reads.
export function esploraBaseUrl(network: BitcoinNetwork): string {
  switch (network) {
    case "mainnet":
      return "https://mempool.space/api";
    case "testnet":
      return "https://mempool.space/testnet/api";
    case "signet":
      return "https://mempool.space/signet/api";
    case "regtest":
      // No public regtest Esplora; user is expected to override via
      // env. Returning a placeholder keeps the type exhaustive.
      return "http://localhost:3002";
  }
}

export function mempoolSpaceTxUrl(
  txid: string,
  network: BitcoinNetwork,
): string {
  switch (network) {
    case "mainnet":
      return `https://mempool.space/tx/${txid}`;
    case "testnet":
      return `https://mempool.space/testnet/tx/${txid}`;
    case "signet":
      return `https://mempool.space/signet/tx/${txid}`;
    case "regtest":
      return `http://localhost:3002/tx/${txid}`;
  }
}

export function mempoolSpaceAddressUrl(
  address: string,
  network: BitcoinNetwork,
): string {
  switch (network) {
    case "mainnet":
      return `https://mempool.space/address/${address}`;
    case "testnet":
      return `https://mempool.space/testnet/address/${address}`;
    case "signet":
      return `https://mempool.space/signet/address/${address}`;
    case "regtest":
      return `http://localhost:3002/address/${address}`;
  }
}

// ─── Esplora — balance + UTXOs ────────────────────────────────────

export interface EsploraUtxo {
  txid: string;
  vout: number;
  /** Confirmed value in satoshis. */
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

/**
 * Confirmed + mempool balance in satoshis for a Bitcoin address.
 * Returns 0 for fresh addresses Esplora doesn't recognise.
 */
export async function fetchBitcoinBalance(
  address: string,
  network: BitcoinNetwork = DEFAULT_BITCOIN_NETWORK,
): Promise<bigint> {
  const url = `${esploraBaseUrl(network)}/address/${encodeURIComponent(address)}`;
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
  const url = `${esploraBaseUrl(network)}/address/${encodeURIComponent(address)}/utxo`;
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
  /** Witness program — 20 bytes for P2WPKH, 32 bytes for P2WSH/taproot. */
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
      // tb is shared between testnet and signet; we collapse both to
      // the wallet's expected network in `validateBtcDestination`.
      return "signet";
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
 * `recipient_pkh` param. Refuses non-v0 (no taproot output yet — the
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
      reason: "Invalid bech32 address — check for typos or copy-paste errors.",
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
