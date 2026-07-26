import type { SwapAssetId } from "@/lib/swap/drafts";

export interface SolverInventoryAsset {
  asset: SwapAssetId;
  network: "solana-devnet" | "bitcoin-testnet" | "ethereum-sepolia" | "research";
  available: number;
  reserved: number;
  address: string;
}

export interface SolverInventoryConfig {
  solverId: string;
  assets: SolverInventoryAsset[];
}

const DEFAULT_INVENTORY: SolverInventoryConfig = {
  solverId: process.env.CLEARSIG_SWAP_SOLVER_ID ?? "clearsig-testnet-solver",
  assets: [
    {
      asset: "SOL",
      network: "solana-devnet",
      available: readNumberEnv("CLEARSIG_SWAP_SOL_AVAILABLE", 100),
      reserved: 0,
      address:
        process.env.CLEARSIG_SWAP_SOL_VAULT ??
        "devnet-sol-liquidity-vault-not-configured",
    },
    {
      asset: "BTC",
      network: "bitcoin-testnet",
      available: readNumberEnv("CLEARSIG_SWAP_BTC_AVAILABLE", 0.25),
      reserved: 0,
      address:
        process.env.CLEARSIG_SWAP_BTC_VAULT ??
        "testnet-btc-liquidity-vault-not-configured",
    },
    {
      asset: "ETH",
      network: "ethereum-sepolia",
      available: readNumberEnv("CLEARSIG_SWAP_ETH_AVAILABLE", 10),
      reserved: 0,
      address:
        process.env.CLEARSIG_SWAP_ETH_VAULT ??
        "sepolia-eth-liquidity-vault-not-configured",
    },
    {
      asset: "ZEC",
      network: "research",
      available: 0,
      reserved: 0,
      address: "research-only",
    },
    {
      asset: "HYPE",
      network: "research",
      available: 0,
      reserved: 0,
      address: "research-only",
    },
  ],
};

export function readSolverInventoryConfig(): SolverInventoryConfig {
  return DEFAULT_INVENTORY;
}

export function inventoryFor(asset: SwapAssetId): SolverInventoryAsset | null {
  return (
    readSolverInventoryConfig().assets.find((item) => item.asset === asset) ??
    null
  );
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
