// Block-explorer URL helpers for every chain clear-msig can drive.
//
// `chain_kind` matches programs/clear-wallet/src/state/intent.rs and
// cli/src/chains/mod.rs:
//   0 = Solana             → explorer.solana.com (cluster from RPC URL)
//   1 = EVM 1559           → Etherscan family, picked from destination RPC URL
//   2 = Bitcoin P2WPKH     → mempool.space (testnet vs mainnet from RPC URL)
//   3 = Zcash transparent  → zcashblockexplorer.com
//   4 = EVM 1559 ERC-20    → same as EVM 1559
//   5 = Hyperliquid HyperEVM→ Hyperliquid explorer
//
// The CLI's `BroadcastResult` (cli/src/chains/mod.rs) carries an
// optional `explorer_url` that some chains (Bitcoin) populate
// server-side. When that's present we trust it; otherwise we derive
// from the chain_kind + tx_id + the destination RPC URL the user
// configured. Falls back to `null` for unknown setups so the UI can
// gracefully omit the link.

import { appConfig } from "@/lib/config";

const SOLANA_BASE = "https://explorer.solana.com";

const SOLANA_CLUSTER_QS =
  (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "").includes("devnet")
    ? "?cluster=devnet"
    : "";

/// Solana mainnet/devnet explorer link for a transaction signature.
/// Existing call sites use this directly; kept for backward compat.
export function txUrl(signature: string): string {
  return `${SOLANA_BASE}/tx/${signature}${SOLANA_CLUSTER_QS}`;
}

/// Solana address page on the explorer.
export function addressUrl(address: string): string {
  return `${SOLANA_BASE}/address/${address}${SOLANA_CLUSTER_QS}`;
}

/// Optional fields carried in the JSON the backend returns from
/// `proposal execute --broadcast`. Mirror of cli/src/chains/mod.rs::
/// BroadcastResult. All fields optional because older CLIs may not
/// populate every one.
export interface BroadcastResultLike {
  chain_kind?: number;
  tx_id?: string;
  chain?: string;
  explorer_url?: string | null;
}

/// Render label for the explorer of a given chain. `null` when we
/// don't recognize the chain so the UI can fall back to "View tx".
export function explorerLabelForChainKind(
  chainKind: number | undefined,
  destinationRpcUrl?: string,
): string {
  switch (chainKind) {
    case 0:
      return "Solana Explorer";
    case 1:
    case 4:
      return etherscanLabelFromRpc(
        destinationRpcUrl ?? appConfig.preAlpha.destinationRpcUrl,
      );
    case 5:
      return "Hyperliquid Explorer";
    case 2:
      return mempoolLabelFromRpc(
        destinationRpcUrl ?? appConfig.preAlpha.destinationRpcUrl,
      );
    case 3:
      return "Zcash Explorer";
    default:
      return "View transaction";
  }
}

/// Per-chain address page on the right explorer. Audit affordance
/// for the wallet hero ("show me this wallet PDA on Solscan") and
/// the per-chain rows ("show me my Sepolia address on Etherscan").
/// Returns null for unknown chains so callers can hide the link
/// rather than render a dead one.
export function addressUrlForChainKind(
  chainKind: number,
  address: string,
  destinationRpcUrl?: string,
): string | null {
  if (!address) return null;
  const rpc = destinationRpcUrl ?? appConfig.preAlpha.destinationRpcUrl;
  switch (chainKind) {
    case 0:
      return addressUrl(address);
    case 1:
    case 4:
      return `${etherscanFromRpc(rpc).base}/address/${address}`;
    case 5:
      return `https://app.hyperliquid.xyz/explorer/address/${address}`;
    case 2:
      return `${mempoolFromRpc(rpc).base}/address/${address}`;
    case 3:
      return `https://zcashblockexplorer.com/address/${address}`;
    default:
      return null;
  }
}

/// Compute the explorer URL for a successful broadcast. Trusts the
/// CLI's `explorer_url` when present; otherwise derives one from
/// chain_kind + tx_id. Returns `null` when no usable URL can be
/// constructed (unknown chain, missing tx_id, etc.). Pass the
/// destination RPC URL when the chain is EVM/BTC so we can pick the
/// right Etherscan/mempool variant.
export function broadcastExplorerUrl(
  broadcast: BroadcastResultLike | null | undefined,
  destinationRpcUrl?: string,
): string | null {
  if (!broadcast) return null;
  if (broadcast.explorer_url) return broadcast.explorer_url;
  if (!broadcast.tx_id) return null;
  const rpc = destinationRpcUrl ?? appConfig.preAlpha.destinationRpcUrl;
  switch (broadcast.chain_kind) {
    case 0:
      return txUrl(broadcast.tx_id);
    case 1:
    case 4:
      return etherscanTxUrl(broadcast.tx_id, rpc);
    case 5:
      return `https://app.hyperliquid.xyz/explorer/tx/${broadcast.tx_id}`;
    case 2:
      return mempoolTxUrl(broadcast.tx_id, rpc);
    case 3:
      return `https://zcashblockexplorer.com/tx/${broadcast.tx_id}`;
    default:
      return null;
  }
}

// ── Etherscan family ──────────────────────────────────────────────
//
// Pick the right explorer for the EVM destination by sniffing well-
// known substrings in the configured RPC URL. Conservative - falls
// through to Etherscan mainnet only when nothing testnet-shaped
// matches, and returns `null` for chains we don't know.

interface EvmExplorer {
  base: string;
  label: string;
}

function etherscanFromRpc(rpcUrl: string): EvmExplorer {
  const u = rpcUrl.toLowerCase();
  if (u.includes("sepolia")) return { base: "https://sepolia.etherscan.io", label: "Sepolia Etherscan" };
  if (u.includes("goerli")) return { base: "https://goerli.etherscan.io", label: "Goerli Etherscan" };
  if (u.includes("holesky")) return { base: "https://holesky.etherscan.io", label: "Holesky Etherscan" };
  if (u.includes("base-sepolia") || (u.includes("base") && u.includes("sepolia"))) {
    return { base: "https://sepolia.basescan.org", label: "Base Sepolia BaseScan" };
  }
  if (u.includes("base.org") || u.includes("basescan")) {
    return { base: "https://basescan.org", label: "BaseScan" };
  }
  if (u.includes("arbitrum-sepolia")) return { base: "https://sepolia.arbiscan.io", label: "Arbiscan (Sepolia)" };
  if (u.includes("arb1") || u.includes("arbitrum")) return { base: "https://arbiscan.io", label: "Arbiscan" };
  if (u.includes("optimism-sepolia") || u.includes("op-sepolia")) {
    return { base: "https://sepolia-optimism.etherscan.io", label: "Optimism Sepolia Etherscan" };
  }
  if (u.includes("optimism") || u.includes("op-mainnet")) {
    return { base: "https://optimistic.etherscan.io", label: "Optimistic Etherscan" };
  }
  if (u.includes("polygon-amoy") || u.includes("amoy")) {
    return { base: "https://amoy.polygonscan.com", label: "Amoy PolygonScan" };
  }
  if (u.includes("polygon")) return { base: "https://polygonscan.com", label: "PolygonScan" };
  return { base: "https://etherscan.io", label: "Etherscan" };
}

function etherscanTxUrl(txHash: string, rpcUrl: string): string {
  return `${etherscanFromRpc(rpcUrl).base}/tx/${normalizeEvmTxHash(txHash)}`;
}

function etherscanLabelFromRpc(rpcUrl: string): string {
  return etherscanFromRpc(rpcUrl).label;
}

/// EVM tx hashes need a leading 0x. The CLI emits them without one
/// in some paths and with one in others; normalise here so the
/// Etherscan link always works.
function normalizeEvmTxHash(txHash: string): string {
  return txHash.startsWith("0x") ? txHash : `0x${txHash}`;
}

// ── Bitcoin (mempool.space) ───────────────────────────────────────

function mempoolFromRpc(rpcUrl: string): { base: string; label: string } {
  const u = rpcUrl.toLowerCase();
  if (u.includes("/testnet/") || u.includes("testnet.")) {
    return { base: "https://mempool.space/testnet", label: "Mempool (testnet)" };
  }
  if (u.includes("/signet/") || u.includes("signet.")) {
    return { base: "https://mempool.space/signet", label: "Mempool (signet)" };
  }
  return { base: "https://mempool.space", label: "Mempool" };
}

function mempoolTxUrl(txid: string, rpcUrl: string): string {
  return `${mempoolFromRpc(rpcUrl).base}/tx/${txid}`;
}

function mempoolLabelFromRpc(rpcUrl: string): string {
  return mempoolFromRpc(rpcUrl).label;
}
