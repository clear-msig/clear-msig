// Per-chain balance fetchers.
//
// Each chain Clear binds via Ika has a chain-native address (the
// dWallet pubkey, encoded for that chain). We surface the live
// balance held at that address on the chains list so users can
// see what's actually in the wallet on each chain.
//
// All fetchers return a `bigint` in the chain's smallest unit
// (lamports / wei / sats / zats) for byte-accurate display, and
// throw on network failure so react-query's error state renders
// a clean "-" placeholder.
//
// Endpoints we hit:
//   - Solana:  configured RPC (with the fallback Connection)
//   - EVM:     destination RPC URL the user configured
//              (NEXT_PUBLIC_DESTINATION_RPC_URL)
//   - Bitcoin: mempool.space REST (testnet vs mainnet inferred
//              from the destination RPC's path)
//   - Zcash:   fetched via a user-configured Zcash RPC endpoint.
//              Caller can render "-" when this returns null.

import { Connection, PublicKey } from "@solana/web3.js";
import type { ChainBindingResponse } from "@/lib/api/types";
import { fetchBitcoinAddressSnapshot } from "@/lib/chain/btc";
import { fetchZcashBalance } from "@/lib/chain/zcash";

export interface ChainBalance {
  /// Smallest-unit balance (lamports / wei / sats). `null` when the
  /// chain has no balance source we can hit (Zcash today).
  raw: bigint | null;
  /// The address we queried - useful for "balance at 0x…abc" copy.
  address: string;
}

/// Fetch the balance for a chain binding using the chain's native
/// RPC. Returns `null` when no balance source is available.
export async function fetchChainBalance(
  binding: ChainBindingResponse,
  ctx: {
    solanaConnection: Connection;
    evmRpcUrl: string;
    zcashRpcUrl: string;
  },
): Promise<ChainBalance | null> {
  switch (binding.chain_kind) {
    case 0: {
      const addr = binding.solana_address;
      if (!addr) return null;
      const lamports = await ctx.solanaConnection.getBalance(
        new PublicKey(addr),
        "confirmed",
      );
      return { raw: BigInt(lamports), address: addr };
    }
    case 1:
    case 4: {
      const addr = binding.evm_address;
      if (!addr) return null;
      const wei = await fetchEvmBalance(ctx.evmRpcUrl, addr);
      return { raw: wei, address: addr };
    }
    case 5: {
      const addr = binding.evm_address;
      if (!addr) return null;
      const wei = await fetchEvmBalance(ctx.evmRpcUrl, addr);
      return { raw: wei, address: addr };
    }
    case 2: {
      // Pre-alpha is testnet/signet across the board. Prefer the
      // testnet address when available (always populated by the
      // backend in pre-alpha) so balance polls hit mempool.space's
      // testnet/signet endpoint, not mainnet (where the dWallet has
      // no UTXOs and the user would see "0 BTC" forever).
      const addr =
        binding.btc_p2wpkh_testnet ?? binding.btc_p2wpkh_mainnet ?? null;
      if (!addr) return null;
      const snapshot = await fetchBitcoinAddressSnapshot(addr);
      return { raw: snapshot.balanceSats, address: addr };
    }
    case 3: {
      const addr =
        binding.zcash_t_addr_testnet ?? binding.zcash_t_addr_mainnet ?? null;
      if (!addr) return null;
      const zats = await fetchZcashBalance(ctx.zcashRpcUrl, addr);
      return { raw: zats, address: addr };
    }
    default:
      return null;
  }
}

// ── EVM balance ───────────────────────────────────────────────────

async function fetchEvmBalance(rpcUrl: string, address: string): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  if (!res.ok) {
    throw new Error(`eth_getBalance HTTP ${res.status}`);
  }
  const json: { result?: string; error?: { message?: string } } = await res.json();
  if (json.error) {
    throw new Error(`eth_getBalance: ${json.error.message ?? "rpc error"}`);
  }
  if (typeof json.result !== "string") {
    throw new Error("eth_getBalance: missing result");
  }
  // result is "0x" + hex wei
  return BigInt(json.result);
}

/// Format a smallest-unit balance for display using the chain's
/// catalog metadata. Returns `null` when raw is null (e.g. Zcash).
export function formatChainBalance(
  raw: bigint | null,
  smallestPerWhole: bigint,
  displayDecimals: number,
): string | null {
  if (raw === null) return null;
  if (raw === 0n) return "0";
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / smallestPerWhole;
  const fraction = abs - whole * smallestPerWhole;
  if (displayDecimals === 0) return `${negative ? "-" : ""}${whole.toString()}`;
  // Pad the fractional component to the chain's full precision, then
  // truncate to displayDecimals so a wallet holding 0.0001 ETH
  // doesn't render as "0".
  const wholeDigits = smallestPerWhole.toString().length - 1;
  const fracStr = fraction.toString().padStart(wholeDigits, "0");
  const truncated = fracStr.slice(0, displayDecimals).replace(/0+$/, "");
  if (truncated.length === 0) return `${negative ? "-" : ""}${whole.toString()}`;
  return `${negative ? "-" : ""}${whole.toString()}.${truncated}`;
}
