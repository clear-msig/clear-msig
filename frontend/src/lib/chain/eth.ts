"use client";

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
/// a contact name to show.
export function shortEvmAddress(s: string): string {
  const t = s.trim();
  if (!HEX_RE.test(t)) return t;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
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
  const url = rpcUrl ?? process.env.NEXT_PUBLIC_DESTINATION_RPC_URL;
  if (!url) {
    throw new Error("EVM RPC URL not configured (NEXT_PUBLIC_DESTINATION_RPC_URL).");
  }
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
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) {
    throw new Error(`EVM RPC error: ${json.error.message ?? "unknown"}`);
  }
  if (typeof json.result !== "string") {
    throw new Error("EVM RPC returned no result");
  }
  // result is "0x<hex>". Convert to int.
  return { nonce: parseInt(json.result, 16) };
}
