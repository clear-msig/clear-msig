// Translation between clear-msig's `chain_kind` byte and the ramp
// service's `chain_family` + `chain_id` strings.
//
// clear-msig's on-chain IkaConfig uses:
//   0 = solana       (SOL native, EdDSA)
//   1 = evm_1559     (ETH / L2 native, secp256k1 ECDSA)
//   2 = bitcoin_p2wpkh                    (BTC native)
//   3 = zcash_transparent                 (ZEC transparent)
//   4 = evm_1559_erc20                    (ERC-20 token transfers)
//
// rust-settlement uses:
//   chain_family ∈ { "solana" | "evm" | "bitcoin" | "zcash" }
//   chain_id     = the chain-specific identifier ("1" for ETH mainnet,
//                  "11155111" for Sepolia, "mainnet"/"testnet" for
//                  Bitcoin and Zcash, "mainnet-beta"/"devnet" for
//                  Solana).

import type { ChainFamily } from "@/lib/ramp/types";

export type RampChainTarget = {
  chain_family: ChainFamily;
  chain_id: string;
  asset_symbol: string;
  /// Smallest unit per whole asset (lamports/wei/sats/zats).
  smallest_per_whole: bigint;
  /// Display decimals to surface in retail UI.
  display_decimals: number;
};

/// Map an on-chain ChainKind byte (from `chain_kind` in IkaConfig)
/// to the ramp service's expected target. `chainEnv` lets the caller
/// signal whether they're hitting mainnet or testnet — clear-msig is
/// devnet-only today, so the default is testnet.
export function rampTargetForChainKind(
  kind: number,
  chainEnv: "mainnet" | "testnet" = "testnet",
): RampChainTarget | null {
  switch (kind) {
    case 0: // solana
      return {
        chain_family: "solana",
        chain_id: chainEnv === "mainnet" ? "mainnet-beta" : "devnet",
        asset_symbol: "SOL",
        smallest_per_whole: 1_000_000_000n,
        display_decimals: 4,
      };
    case 1: // evm_1559 — Ethereum / Sepolia
      return {
        chain_family: "evm",
        chain_id: chainEnv === "mainnet" ? "1" : "11155111",
        asset_symbol: "ETH",
        smallest_per_whole: 1_000_000_000_000_000_000n,
        display_decimals: 6,
      };
    case 2: // bitcoin_p2wpkh
      return {
        chain_family: "bitcoin",
        chain_id: chainEnv === "mainnet" ? "mainnet" : "testnet",
        asset_symbol: "BTC",
        smallest_per_whole: 100_000_000n,
        display_decimals: 8,
      };
    case 3: // zcash_transparent
      return {
        chain_family: "zcash",
        chain_id: chainEnv === "mainnet" ? "mainnet" : "testnet",
        asset_symbol: "ZEC",
        smallest_per_whole: 100_000_000n,
        display_decimals: 8,
      };
    case 4: // evm_1559_erc20 — folded into ETH, caller passes token
      // address in the metadata path.
      return {
        chain_family: "evm",
        chain_id: chainEnv === "mainnet" ? "1" : "11155111",
        asset_symbol: "ERC20",
        smallest_per_whole: 1_000_000n, // USDC-shaped default; override per token
        display_decimals: 2,
      };
    default:
      return null;
  }
}

/// Convert a whole-asset string ("0.05") to its smallest-unit BigInt.
/// Returns null on invalid input. Truncates beyond the chain's
/// precision rather than rounding (defensive — operator hot wallets
/// shouldn't pay extra fractions due to rounding).
export function wholeToMinor(
  whole: string,
  smallest_per_whole: bigint,
  display_decimals: number,
): bigint | null {
  const trimmed = whole.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    return null;
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  const decimals = String(smallest_per_whole).length - 1;
  const padded = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  // Suppress the unused-binding warning — display_decimals is part of
  // the public API for callers who want to round-trip-check.
  void display_decimals;
  try {
    return BigInt(intPart || "0") * smallest_per_whole + BigInt(padded || "0");
  } catch {
    return null;
  }
}

/// Format a smallest-unit amount as a whole-asset string with the
/// chain's preferred display precision. E.g. 100_000_000 sats →
/// "1.00000000".
export function minorToWhole(
  minor: bigint,
  smallest_per_whole: bigint,
  display_decimals: number,
): string {
  const whole = minor / smallest_per_whole;
  const frac = minor % smallest_per_whole;
  const decimals = String(smallest_per_whole).length - 1;
  const padded = frac.toString().padStart(decimals, "0");
  const sliced = padded.slice(0, display_decimals);
  return sliced.length > 0 ? `${whole.toString()}.${sliced}` : whole.toString();
}
