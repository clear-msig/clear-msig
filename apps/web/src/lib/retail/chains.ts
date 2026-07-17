// Chain catalog - retail-friendly metadata for every chain Clear can
// bind a wallet to via Ika's dWallet network.
//
// Maps the on-chain `chain_kind` byte (and the addWalletChain API's
// `chain` string identifier) to the name, gradient, and copy users
// actually see. Keep this as the single source of truth so the
// list page, the add-chain picker, the Send-chain selector, and any
// future surfaces all render the same way.

export interface ChainMeta {
  /// `chain_kind` byte from the on-chain IkaConfig account.
  /// Source of truth: programs/clear-wallet/src/chains/mod.rs::ChainKind
  kind: number;
  /// `chain` string the addWalletChain API expects.
  apiName: string;
  /// Three-letter ticker - what users see on amounts ("0.5 SOL").
  ticker: string;
  /// Currency-style glyph - fallback when the logo image fails to load
  /// or is still loading. ◎ Solana, Ξ Ethereum, ₿ Bitcoin, ⓩ Zcash.
  symbol: string;
  /// CoinGecko CDN logo. Stable public URLs; cached at the edge.
  /// `<ChainBadge>` falls back to `symbol` if the image errors.
  logoUrl: string;
  /// Marketing name shown in cards and headers.
  name: string;
  /// One-line retail blurb - what a non-crypto user gets from the chain.
  description: string;
  /// Tailwind gradient classes - used for the badge background ring
  /// and glyph fallback. Brand color family per chain.
  gradient: { from: string; to: string };
  /// Smallest unit per ticker - what the chain stores on-wire.
  /// SOL=lamports (1e9), ETH=wei (1e18), BTC=sats (1e8), ZEC=zats (1e8), HYPE=wei (1e18).
  smallestPerWhole: bigint;
  /// Decimal places to surface for retail amounts. Chains like
  /// Bitcoin / Ethereum want more precision than dollars.
  displayDecimals: number;
}

/// Visible-in-retail chains. ERC-20 (kind 4) is folded into Ethereum
/// in the user-facing surface - adding "Ethereum" makes the wallet
/// able to send both ETH and ERC-20 tokens.
export const CHAIN_CATALOG: readonly ChainMeta[] = [
  {
    kind: 0,
    apiName: "solana",
    ticker: "SOL",
    symbol: "◎",
    logoUrl:
      "https://assets.coingecko.com/coins/images/4128/large/solana.png",
    name: "Solana",
    description: "Fast, low-fee. Where Clear starts.",
    gradient: { from: "from-purple-500", to: "to-emerald-400" },
    smallestPerWhole: 1_000_000_000n,
    displayDecimals: 4,
  },
  {
    kind: 1,
    apiName: "evm_1559",
    ticker: "ETH",
    symbol: "Ξ",
    logoUrl:
      "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    name: "Ethereum",
    description: "The original. Send ETH or any token on it.",
    gradient: { from: "from-slate-500", to: "to-indigo-400" },
    smallestPerWhole: 1_000_000_000_000_000_000n,
    displayDecimals: 6,
  },
  {
    kind: 2,
    apiName: "bitcoin_p2wpkh",
    ticker: "BTC",
    symbol: "₿",
    logoUrl: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    name: "Bitcoin",
    description: "The original store of value.",
    gradient: { from: "from-orange-400", to: "to-amber-500" },
    smallestPerWhole: 100_000_000n,
    displayDecimals: 8,
  },
  {
    kind: 3,
    apiName: "zcash_transparent",
    ticker: "ZEC",
    symbol: "ⓩ",
    logoUrl:
      "https://assets.coingecko.com/coins/images/486/large/circle-zcash-color.png",
    name: "Zcash",
    description: "Privacy-first money.",
    gradient: { from: "from-amber-400", to: "to-yellow-500" },
    smallestPerWhole: 100_000_000n,
    displayDecimals: 8,
  },
  {
    kind: 5,
    apiName: "hyperliquid_evm",
    ticker: "HYPE",
    symbol: "H",
    logoUrl:
      "https://assets.coingecko.com/coins/images/50882/large/hyperliquid.jpg",
    name: "Hyperliquid",
    description: "High-performance EVM trading chain.",
    gradient: { from: "from-cyan-500", to: "to-sky-400" },
    smallestPerWhole: 1_000_000_000_000_000_000n,
    displayDecimals: 6,
  },
] as const;

export const CHAIN_DISPLAY_ORDER = [0, 1, 2, 3, 5] as const;

export function chainDisplayRank(kind: number): number {
  const index = CHAIN_DISPLAY_ORDER.indexOf(
    kind as (typeof CHAIN_DISPLAY_ORDER)[number],
  );
  return index === -1 ? CHAIN_DISPLAY_ORDER.length : index;
}

export function chainByKind(kind: number): ChainMeta | undefined {
  return CHAIN_CATALOG.find((c) => c.kind === kind);
}

export function chainByApiName(apiName: string): ChainMeta | undefined {
  const normalized = apiName.toLowerCase();
  if (normalized === "hyperliquid") {
    return CHAIN_CATALOG.find((c) => c.kind === 5);
  }
  return CHAIN_CATALOG.find((c) => c.apiName === normalized);
}

/// Retail label for a chain_kind, falling back to "Other" if we don't
/// recognize it. The `kind_4` ERC-20 case is intentionally rendered
/// as "Ethereum" - it's not a separate chain to a retail user.
export function friendlyChainName(kind: number): string {
  if (kind === 4) return "Ethereum";
  if (kind === 5) return "Hyperliquid";
  return chainByKind(kind)?.name ?? "Other";
}
