// Chain catalog — retail-friendly metadata for every chain Clear can
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
  /// Three-letter retail short label ("SOL" / "ETH" / "BTC" / "ZEC").
  shortName: string;
  /// Marketing name shown in cards and headers.
  name: string;
  /// One-line retail blurb — what a non-crypto user gets from the chain.
  description: string;
  /// Tailwind gradient classes for the chain avatar circle. Pick
  /// distinct color families so two chains never collide visually.
  gradient: { from: string; to: string };
}

/// Visible-in-retail chains. ERC-20 (kind 4) is folded into Ethereum
/// in the user-facing surface — adding "Ethereum" makes the wallet
/// able to send both ETH and ERC-20 tokens.
export const CHAIN_CATALOG: readonly ChainMeta[] = [
  {
    kind: 0,
    apiName: "solana",
    shortName: "SOL",
    name: "Solana",
    description: "Fast, low-fee. Where Clear starts.",
    gradient: { from: "from-purple-400", to: "to-pink-500" },
  },
  {
    kind: 1,
    apiName: "evm_1559",
    shortName: "ETH",
    name: "Ethereum",
    description: "The original. Send ETH or any token on it.",
    gradient: { from: "from-blue-400", to: "to-indigo-500" },
  },
  {
    kind: 2,
    apiName: "bitcoin_p2wpkh",
    shortName: "BTC",
    name: "Bitcoin",
    description: "The original store of value.",
    gradient: { from: "from-orange-400", to: "to-amber-500" },
  },
  {
    kind: 3,
    apiName: "zcash_transparent",
    shortName: "ZEC",
    name: "Zcash",
    description: "Privacy-first. Built for shielded sends.",
    gradient: { from: "from-yellow-300", to: "to-amber-400" },
  },
] as const;

export function chainByKind(kind: number): ChainMeta | undefined {
  return CHAIN_CATALOG.find((c) => c.kind === kind);
}

export function chainByApiName(apiName: string): ChainMeta | undefined {
  return CHAIN_CATALOG.find((c) => c.apiName === apiName);
}

/// Retail label for a chain_kind, falling back to "Other" if we don't
/// recognize it. The `kind_4` ERC-20 case is intentionally rendered
/// as "Ethereum" — it's not a separate chain to a retail user.
export function friendlyChainName(kind: number): string {
  if (kind === 4) return "Ethereum";
  return chainByKind(kind)?.name ?? "Other";
}
