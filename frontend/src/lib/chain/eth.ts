"use client";

import { withEvmFallback } from "@/lib/chain/evmRpcFallback";
import { formatEvmAddressForDisplay } from "@/lib/security/addressFormat";

// Ethereum (Sepolia) helpers for cross-chain send.
//
// Clear's signed-write path lives on Solana — the user signs an
// offchain message that authorises the multisig to act. For non-
// Solana destinations the actual chain transaction is built and
// broadcast by Ika's dWallet network on execute, but the frontend
// still has to compute a few EVM-side facts the backend needs to
// pre-encode the SolTransfer-equivalent EVM template:
//
//   - nonce      : u64 transaction nonce for the wallet's EVM
//                  address. Pulled live from the destination RPC
//                  (eth_getTransactionCount on `pending` so a
//                  same-block resubmit is safe).
//   - to         : 20-byte recipient. Validated client-side because
//                  the backend's encoder fails opaque on bad input.
//   - value_wei  : amount in wei as a bigint. Sepolia ETH has 18
//                  decimals; we convert from the user's friendly
//                  ether-units input.
//
// All three plug into prepare.createProposal as positional `params`
// strings, the same way SolTransfer's destination/amount/nonce do.
//
// Pure module — no React. Imported by /send/eth and the EVM intent
// setup flow.

const HEX_RE = /^0x[0-9a-fA-F]{40}$/;

/// Validate a checksummed-or-lowercased EVM address. We do NOT
/// re-derive the EIP-55 checksum here; lowercase 0x… is just as
/// valid on chain and asking users to re-enter capitalisation is
/// retail-unfriendly. Length + hex character set is what we gate on.
export function isValidEvmAddress(s: string): boolean {
  return HEX_RE.test(s.trim());
}

/// `0x1234…abcd` style abbreviation for display when we don't have
/// a contact name to show. Respects the user's address-format
/// preference (abbreviated / full / EIP-55 checksum) — see
/// lib/security/addressFormat.ts. Default behaviour matches the
/// pre-preference output (abbreviated, EIP-55 case).
export function shortEvmAddress(s: string): string {
  const t = s.trim();
  if (!HEX_RE.test(t)) return t;
  return formatEvmAddressForDisplay(t);
}

/// Convert a user-typed ether amount ("0.05") to wei as a bigint.
/// Throws on non-numeric input so callers can short-circuit before
/// firing a sign popup.
export function ethToWei(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) throw new Error("Amount required");
  const [whole, frac = ""] = trimmed.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new Error("Amount must be numeric");
  }
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  const merged = (whole || "0") + padded;
  // Strip leading zeros so BigInt() doesn't reject "00.." inputs.
  const cleaned = merged.replace(/^0+/, "") || "0";
  return BigInt(cleaned);
}

/// Format wei back into a friendly ether string. Trims trailing
/// zeros after the decimal so "1000000000000000000n" renders as "1"
/// rather than "1.000000000000000000".
export function weiToEth(wei: bigint, displayDecimals = 6): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  if (frac === 0n) return `${negative ? "-" : ""}${whole}`;
  let fracStr = frac.toString().padStart(18, "0");
  // Trim trailing zeros, then truncate to the requested precision.
  fracStr = fracStr.replace(/0+$/, "").slice(0, displayDecimals);
  return `${negative ? "-" : ""}${whole}${fracStr ? "." + fracStr : ""}`;
}

interface NonceResult {
  /// Nonce as a u64. Already an integer, callers can serialise it
  /// straight into the prepare-call params string.
  nonce: number;
}

/// Fetch the wallet's EVM transaction nonce from the destination
/// RPC. Uses `pending` so a same-block resubmit doesn't reuse the
/// same nonce as the in-flight tx.
///
/// rpcUrl defaults to NEXT_PUBLIC_DESTINATION_RPC_URL when not
/// supplied, which on prod points at Sepolia's public node.
export async function fetchEvmNonce(
  walletEvmAddress: string,
  rpcUrl?: string,
): Promise<NonceResult> {
  return withEvmFallback(async (url) => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionCount",
      params: [walletEvmAddress, "pending"],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`EVM RPC returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (json.error) {
      throw new Error(`EVM RPC error: ${json.error.message ?? "unknown"}`);
    }
    if (typeof json.result !== "string") {
      throw new Error("EVM RPC returned no result");
    }
    return { nonce: parseInt(json.result, 16) };
  }, rpcUrl);
}

/// One row from the EVM tx history result. Mirrors the Blockscout
/// API surface; matches the `ChainTxRow` shape consumed by the
/// dashboard `<ChainTxHistorySection>`.
export interface EvmTxRow {
  hash: string;
  /// Unix seconds. Pending txs in the mempool can have ts === 0;
  /// callers should treat that as "right now".
  timestamp: number;
  blockNumber: number;
  from: string;
  to: string;
  /// Wei as a bigint string. Blockscout returns base-10 strings;
  /// we keep them as strings to avoid Number precision loss.
  valueWei: string;
  status: "success" | "failed";
  errorBrief: string | null;
}

/// Fetch recent EVM tx history for an address from Blockscout.
/// Picks the Blockscout instance from the destination RPC URL —
/// Sepolia hits eth-sepolia.blockscout.com, mainnet hits
/// eth.blockscout.com, and so on. Returns up to `limit` rows,
/// newest first. Blockscout is open-source + key-less; if it ever
/// stops being reliable, swap for Etherscan with an API key
/// (one-line change here, no callsite churn).
export async function fetchEvmTxHistory(
  walletEvmAddress: string,
  limit: number = 10,
  rpcUrl?: string,
): Promise<EvmTxRow[]> {
  const url = rpcUrl ?? process.env.NEXT_PUBLIC_DESTINATION_RPC_URL ?? "";
  const explorerBase = blockscoutBaseFromRpc(url);
  const apiUrl = `${explorerBase}/api?module=account&action=txlist&address=${encodeURIComponent(walletEvmAddress)}&page=1&offset=${limit}&sort=desc`;
  const res = await fetch(apiUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Blockscout returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    status: string;
    message: string;
    result: unknown;
  };
  // Blockscout returns status="0" with message="No transactions found"
  // for empty histories — treat as success with empty list.
  if (json.status === "0" && json.message === "No transactions found") {
    return [];
  }
  if (!Array.isArray(json.result)) {
    throw new Error(`Blockscout: ${json.message || "unexpected response"}`);
  }
  return (json.result as Array<Record<string, unknown>>)
    .map((r) => {
      const isError = r.isError === "1" || r.txreceipt_status === "0";
      return {
        hash: typeof r.hash === "string" ? r.hash : "",
        timestamp:
          typeof r.timeStamp === "string" ? parseInt(r.timeStamp, 10) : 0,
        blockNumber:
          typeof r.blockNumber === "string"
            ? parseInt(r.blockNumber, 10)
            : 0,
        from: typeof r.from === "string" ? r.from : "",
        to: typeof r.to === "string" ? r.to : "",
        valueWei: typeof r.value === "string" ? r.value : "0",
        status: isError ? ("failed" as const) : ("success" as const),
        errorBrief:
          isError && typeof r.txreceipt_status === "string"
            ? `tx receipt status ${r.txreceipt_status}`
            : null,
      };
    })
    .filter((row) => row.hash !== "");
}

export function blockscoutBaseFromRpc(rpcUrl: string): string {
  const u = rpcUrl.toLowerCase();
  if (u.includes("sepolia")) return "https://eth-sepolia.blockscout.com";
  if (u.includes("holesky")) return "https://eth-holesky.blockscout.com";
  if (u.includes("base-sepolia")) return "https://base-sepolia.blockscout.com";
  if (u.includes("base.org")) return "https://base.blockscout.com";
  if (u.includes("optimism-sepolia") || u.includes("op-sepolia")) {
    return "https://optimism-sepolia.blockscout.com";
  }
  if (u.includes("optimism")) return "https://optimism.blockscout.com";
  if (u.includes("polygon-amoy") || u.includes("amoy")) {
    return "https://polygon-amoy.blockscout.com";
  }
  if (u.includes("polygon")) return "https://polygon.blockscout.com";
  return "https://eth.blockscout.com";
}

/// Fetch the destination chain's current gas price in wei. Falls
/// back to a generous default if the RPC errors out or returns
/// nonsense — the worst case here is over-reserving for gas, not
/// under-reserving (which would let a doomed send through).
///
/// Used to size the "gas reserve" subtracted from the wallet
/// balance in the send-eth pre-flight check + Max button. EIP-1559
/// chains have eth_gasPrice as a single "expected total" estimate
/// (priority fee + base fee), which is good enough for a UI
/// reserve — the actual broadcast can spend up to its own
/// max_fee_per_gas anyway.
export async function fetchEvmGasPrice(rpcUrl?: string): Promise<bigint> {
  return withEvmFallback(async (url) => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_gasPrice",
      params: [],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`EVM RPC returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (json.error) {
      throw new Error(`EVM RPC error: ${json.error.message ?? "unknown"}`);
    }
    if (typeof json.result !== "string") {
      throw new Error("EVM RPC returned no result");
    }
    return BigInt(json.result);
  }, rpcUrl);
}

/// Fetch the wallet's EVM balance in wei from the destination RPC.
/// Returns a bigint for byte-accurate comparisons (don't lose
/// precision through Number for sub-wei display logic).
///
/// Used by the send-ETH compose stage to surface "you have X ETH"
/// inline and to gate the submit button on
/// `balance >= amount + gas_reserve` before we ever fire a sign
/// popup. The previous flow let users propose + sign + execute and
/// then fail at the broadcast step with an opaque error; checking
/// up-front turns "ika_sign failed" toasts into "you don't have
/// enough Sepolia ETH" copy.
export async function fetchEvmBalance(
  walletEvmAddress: string,
  rpcUrl?: string,
): Promise<bigint> {
  return withEvmFallback(async (url) => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [walletEvmAddress, "latest"],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`EVM RPC returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (json.error) {
      throw new Error(`EVM RPC error: ${json.error.message ?? "unknown"}`);
    }
    if (typeof json.result !== "string") {
      throw new Error("EVM RPC returned no result");
    }
    return BigInt(json.result);
  }, rpcUrl);
}
