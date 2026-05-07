"use client";

// ERC-20 read helpers via eth_call.
//
// Tokens on EVM chains are addressable contracts that implement the
// ERC-20 ABI (decimals, symbol, name, balanceOf, transfer, …). Most
// of what the wallet UI needs is metadata (decimals, symbol) and
// balance — both are pure read calls, so we hit the destination RPC
// directly via JSON-RPC `eth_call` and decode the bytes32-padded
// return value ourselves. No web3 / ethers dep — keeps the bundle
// lean.
//
// Used by:
//   - the token send page (decimals + symbol on contract paste)
//   - the dashboard token-balance widget (balanceOf for the dWallet
//     EVM address)
//
// Function selectors are the first 4 bytes of keccak256("name(types)").
// Hard-coded here as constants so we don't hash at call time.
//
// Selectors:
//   decimals()                — 0x313ce567
//   symbol()                  — 0x95d89b41
//   name()                    — 0x06fdde03
//   balanceOf(address)        — 0x70a08231

const SEL_DECIMALS = "0x313ce567";
const SEL_SYMBOL = "0x95d89b41";
const SEL_NAME = "0x06fdde03";
const SEL_BALANCE_OF = "0x70a08231";

const HEX_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidErc20Contract(s: string): boolean {
  return HEX_RE.test(s.trim());
}

export interface Erc20Metadata {
  /// Number of decimals the token reports.
  decimals: number;
  /// Token ticker (USDC, DAI, etc).
  symbol: string;
  /// Long name, e.g. "USD Coin". Optional — many tokens implement
  /// `name()` but it's not strictly required by the standard.
  name: string | null;
}

export async function fetchErc20Metadata(
  contractAddress: string,
  rpcUrl?: string,
): Promise<Erc20Metadata> {
  const url = rpcUrl ?? process.env.NEXT_PUBLIC_DESTINATION_RPC_URL;
  if (!url) throw new Error("EVM RPC URL not configured");
  if (!isValidErc20Contract(contractAddress)) {
    throw new Error("Token contract must be a 0x… 42-character address");
  }

  // Run all three calls in parallel. `name()` failures are
  // swallowed — some tokens omit it.
  const [decRaw, symRaw, nameRaw] = await Promise.all([
    ethCall(url, contractAddress, SEL_DECIMALS),
    ethCall(url, contractAddress, SEL_SYMBOL),
    ethCall(url, contractAddress, SEL_NAME).catch(() => "0x"),
  ]);

  return {
    decimals: decodeUint8(decRaw),
    symbol: decodeAbiString(symRaw),
    name: nameRaw === "0x" ? null : decodeAbiString(nameRaw),
  };
}

/// Fetch an address's balance of a given ERC-20 token. Returns the
/// raw bigint in the token's smallest unit; convert to display via
/// `bigint / 10n ** BigInt(decimals)`.
export async function fetchErc20Balance(
  contractAddress: string,
  holderAddress: string,
  rpcUrl?: string,
): Promise<bigint> {
  const url = rpcUrl ?? process.env.NEXT_PUBLIC_DESTINATION_RPC_URL;
  if (!url) throw new Error("EVM RPC URL not configured");
  if (!isValidErc20Contract(contractAddress)) {
    throw new Error("Token contract must be a 0x… 42-character address");
  }
  if (!HEX_RE.test(holderAddress.trim())) {
    throw new Error("Holder must be a 0x… 42-character address");
  }
  // calldata = selector + 32-byte left-padded address
  const padded = holderAddress.trim().slice(2).toLowerCase().padStart(64, "0");
  const data = SEL_BALANCE_OF + padded;
  const raw = await ethCall(url, contractAddress, data);
  if (raw === "0x" || raw === "0x0") return 0n;
  return BigInt(raw);
}

// ── JSON-RPC eth_call ────────────────────────────────────────────

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string,
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  if (!res.ok) throw new Error(`eth_call HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: string;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(`eth_call: ${json.error.message ?? "unknown rpc error"}`);
  }
  if (typeof json.result !== "string") {
    throw new Error("eth_call: missing result");
  }
  return json.result;
}

// ── ABI decoders ────────────────────────────────────────────────
//
// Hand-rolled to avoid pulling in ethers/web3. Just enough to
// handle the three return types we actually call:
//
//   uint8        — `decimals()`
//   string       — `symbol()` / `name()`
//   uint256      — `balanceOf(address)` (handled inline above via BigInt)

function decodeUint8(hex: string): number {
  if (hex === "0x" || hex.length < 2) return 0;
  // The whole 32-byte word is returned; the value is the last byte.
  const stripped = hex.slice(2).padStart(64, "0");
  return parseInt(stripped.slice(-2), 16);
}

function decodeAbiString(hex: string): string {
  if (hex === "0x" || hex.length < 2) return "";
  const data = hex.slice(2);

  // Solidity returns dynamic strings as:
  //   [32 bytes offset = 0x20][32 bytes length][bytes...]
  // BUT some non-conforming tokens (early USDT mainnet famously)
  // return a fixed-32-byte ASCII string. Detect the conforming
  // form by checking the offset bytes.
  if (data.length >= 128 && data.slice(0, 64).endsWith("20")) {
    const len = parseInt(data.slice(64, 128), 16);
    if (Number.isFinite(len) && len > 0 && data.length >= 128 + len * 2) {
      return hexToUtf8(data.slice(128, 128 + len * 2));
    }
  }

  // Non-conforming fixed-32: trim trailing zero bytes.
  const trimmed = data.slice(0, 64).replace(/(00)+$/, "");
  return hexToUtf8(trimmed);
}

function hexToUtf8(hex: string): string {
  if (hex.length === 0) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  } catch {
    return "";
  }
}

/// One ERC-20 the wallet currently holds. Decimals comes back as a
/// string from Blockscout — parse to number for downstream math.
export interface Erc20Holding {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  /// Raw on-chain balance in the token's smallest unit.
  rawBalance: bigint;
}

/// Fetch every ERC-20 the wallet's EVM address holds. Uses
/// Blockscout's v2 token-balances endpoint (free, key-less). Sorted
/// most-recent-activity first by the API; we additionally drop any
/// rows whose token type isn't "ERC-20" (Blockscout also returns
/// ERC-721 + ERC-1155 from the same endpoint when those slots have
/// activity, and our send page is ERC-20 only).
export async function fetchErc20Holdings(
  walletEvmAddress: string,
  rpcUrl?: string,
): Promise<Erc20Holding[]> {
  const url = rpcUrl ?? process.env.NEXT_PUBLIC_DESTINATION_RPC_URL ?? "";
  // Lazy import the RPC->Blockscout-base mapper from eth.ts so this
  // file stays self-contained (no fetch-time circular import; the
  // module is on the same render path anyway).
  const { blockscoutBaseFromRpc } = await import("@/lib/chain/eth");
  const base = blockscoutBaseFromRpc(url);
  const apiUrl = `${base}/api/v2/addresses/${encodeURIComponent(
    walletEvmAddress,
  )}/token-balances`;
  const res = await fetch(apiUrl, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    // Address never seen on chain → 404, treat as empty holdings.
    if (res.status === 404) return [];
    throw new Error(`Blockscout returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as Array<{
    value?: string;
    token?: {
      address?: string;
      symbol?: string;
      name?: string;
      decimals?: string;
      type?: string;
    };
  }>;
  if (!Array.isArray(json)) return [];
  const out: Erc20Holding[] = [];
  for (const row of json) {
    const t = row.token;
    if (!t) continue;
    if (t.type && t.type !== "ERC-20") continue;
    const contractAddress = (t.address ?? "").toLowerCase();
    if (!HEX_RE.test(contractAddress)) continue;
    const decimals = parseInt(t.decimals ?? "0", 10);
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) continue;
    let raw: bigint;
    try {
      raw = BigInt(row.value ?? "0");
    } catch {
      continue;
    }
    if (raw <= 0n) continue;
    out.push({
      contractAddress,
      symbol: t.symbol ?? "TOKEN",
      name: t.name ?? "Unknown token",
      decimals,
      rawBalance: raw,
    });
  }
  return out;
}

/// Convert a user-typed amount string ("1.5") to the token's
/// smallest unit as a bigint, given the token's decimals. Mirrors
/// `ethToWei` in lib/chain/eth.ts but parameterised on decimals.
export function tokenAmountToBaseUnits(
  amount: string,
  decimals: number,
): bigint {
  const trimmed = amount.trim();
  if (!trimmed) throw new Error("Amount required");
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new Error("Amount must be numeric");
  }
  if (frac.length > decimals) {
    throw new Error(
      `Token only supports ${decimals} decimals; got ${frac.length}`,
    );
  }
  const padded = frac.padEnd(decimals, "0");
  const merged = (whole || "0") + padded;
  const cleaned = merged.replace(/^0+/, "") || "0";
  return BigInt(cleaned);
}

/// Format a base-unit token amount back to a friendly string,
/// trimming trailing zeros. e.g. (1500000n, 6) → "1.5".
export function tokenAmountToString(
  amount: bigint,
  decimals: number,
  displayDecimals: number = decimals,
): string {
  if (amount === 0n) return "0";
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  if (frac === 0n) return `${negative ? "-" : ""}${whole}`;
  let fracStr = frac.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, "").slice(0, displayDecimals);
  return `${negative ? "-" : ""}${whole}${fracStr ? "." + fracStr : ""}`;
}
