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
