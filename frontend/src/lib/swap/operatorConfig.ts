import { readSolverInventoryConfig } from "@/lib/swap/inventory";

export type SwapOperatorState = "ready" | "missing" | "dev";

export interface SwapOperatorRequirement {
  key: string;
  label: string;
  group: "Ika" | "Solver" | "Liquidity" | "Collateral";
  state: SwapOperatorState;
  value: string;
  detail: string;
}

export interface SwapFundingStep {
  asset: "SOL" | "BTC" | "ETH" | "Collateral";
  network: string;
  vaultEnv: string;
  amountEnv: string;
  address: string;
  available: number;
  action: string;
}

export interface SwapOperatorStatus {
  state: "ready" | "needs_setup";
  solverId: string;
  message: string;
  requirements: SwapOperatorRequirement[];
  funding: SwapFundingStep[];
}

const REQUIRED_ENV: Array<
  Omit<SwapOperatorRequirement, "state" | "value"> & {
    fallback?: string;
    isReady?: (value: string | undefined) => boolean;
  }
> = [
  {
    key: "CLEARSIG_SWAP_IKA_ENABLED",
    label: "Ika execution gate",
    group: "Ika",
    detail: "Set to 1 only after the Ika submitter is ready for testnet fills.",
    isReady: (value) => value === "1",
  },
  {
    key: "NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID",
    label: "Ika dWallet program",
    group: "Ika",
    detail: "Use the current Ika pre-alpha Solana program id.",
  },
  {
    key: "NEXT_PUBLIC_IKA_GRPC_URL",
    label: "Ika gRPC endpoint",
    group: "Ika",
    detail: "Use the current Ika pre-alpha endpoint.",
  },
  {
    key: "NEXT_PUBLIC_SOLANA_RPC_URL",
    label: "Solana RPC",
    group: "Ika",
    detail: "Use devnet while Ika and ClearSig are pre-alpha.",
  },
  {
    key: "CLEARSIG_SWAP_SOLVER_ID",
    label: "Solver id",
    group: "Solver",
    detail: "Stable id used in quotes, logs, and settlement receipts.",
    fallback: "clearsig-testnet-solver",
  },
  {
    key: "CLEARSIG_SWAP_SOLVER_URL",
    label: "Solver service URL",
    group: "Solver",
    detail: "Backend endpoint that reserves liquidity and submits fills.",
  },
  {
    key: "CLEARSIG_SWAP_SOL_VAULT",
    label: "SOL vault",
    group: "Liquidity",
    detail: "Devnet SOL address the solver can pay from.",
  },
  {
    key: "CLEARSIG_SWAP_SOL_AVAILABLE",
    label: "SOL inventory",
    group: "Liquidity",
    detail: "Amount of SOL available for testnet fills.",
  },
  {
    key: "CLEARSIG_SWAP_BTC_VAULT",
    label: "BTC vault",
    group: "Liquidity",
    detail: "Bitcoin testnet address controlled by the solver/Ika policy.",
  },
  {
    key: "CLEARSIG_SWAP_BTC_AVAILABLE",
    label: "BTC inventory",
    group: "Liquidity",
    detail: "Amount of BTC testnet liquidity available for fills.",
  },
  {
    key: "CLEARSIG_SWAP_ETH_VAULT",
    label: "ETH vault",
    group: "Liquidity",
    detail: "Sepolia address controlled by the solver/Ika policy.",
  },
  {
    key: "CLEARSIG_SWAP_ETH_AVAILABLE",
    label: "ETH inventory",
    group: "Liquidity",
    detail: "Amount of Sepolia ETH available for fills.",
  },
  {
    key: "CLEARSIG_SWAP_COLLATERAL_VAULT",
    label: "Collateral vault",
    group: "Collateral",
    detail: "Vault used to prove the solver can stand behind a fill.",
  },
  {
    key: "CLEARSIG_SWAP_COLLATERAL_USD",
    label: "Collateral size",
    group: "Collateral",
    detail: "USD value reserved for solver risk checks.",
  },
];

export function readSwapOperatorStatus(): SwapOperatorStatus {
  const inventory = readSolverInventoryConfig();
  const requirements = REQUIRED_ENV.map((item): SwapOperatorRequirement => {
    const raw = process.env[item.key];
    const hasExplicitValue = raw !== undefined && raw.trim() !== "";
    const ready = item.isReady ? item.isReady(raw) : hasExplicitValue;
    const fallback = item.fallback;
    const state: SwapOperatorState = ready
      ? "ready"
      : fallback
      ? "dev"
      : "missing";
    return {
      key: item.key,
      label: item.label,
      group: item.group,
      detail: item.detail,
      state,
      value: ready ? safeValue(raw) : fallback ?? "",
    };
  });

  const missing = requirements.filter((item) => item.state === "missing");
  const funding = buildFundingSteps(inventory);
  return {
    state: missing.length === 0 ? "ready" : "needs_setup",
    solverId: inventory.solverId,
    message:
      missing.length === 0
        ? "Solver setup is ready for testnet fills."
        : `${missing.length} solver setting${missing.length === 1 ? "" : "s"} missing.`,
    requirements,
    funding,
  };
}

function buildFundingSteps(
  inventory: ReturnType<typeof readSolverInventoryConfig>,
): SwapFundingStep[] {
  const byAsset = Object.fromEntries(
    inventory.assets.map((asset) => [asset.asset, asset]),
  );
  return [
    {
      asset: "SOL",
      network: "Solana devnet",
      vaultEnv: "CLEARSIG_SWAP_SOL_VAULT",
      amountEnv: "CLEARSIG_SWAP_SOL_AVAILABLE",
      address: byAsset.SOL?.address ?? "",
      available: byAsset.SOL?.available ?? 0,
      action: "Airdrop or send devnet SOL to the solver vault.",
    },
    {
      asset: "BTC",
      network: "Bitcoin testnet",
      vaultEnv: "CLEARSIG_SWAP_BTC_VAULT",
      amountEnv: "CLEARSIG_SWAP_BTC_AVAILABLE",
      address: byAsset.BTC?.address ?? "",
      available: byAsset.BTC?.available ?? 0,
      action: "Fund the testnet BTC vault from a faucet or test wallet.",
    },
    {
      asset: "ETH",
      network: "Ethereum Sepolia",
      vaultEnv: "CLEARSIG_SWAP_ETH_VAULT",
      amountEnv: "CLEARSIG_SWAP_ETH_AVAILABLE",
      address: byAsset.ETH?.address ?? "",
      available: byAsset.ETH?.available ?? 0,
      action: "Fund the Sepolia ETH vault from a faucet or test wallet.",
    },
    {
      asset: "Collateral",
      network: "Solana devnet",
      vaultEnv: "CLEARSIG_SWAP_COLLATERAL_VAULT",
      amountEnv: "CLEARSIG_SWAP_COLLATERAL_USD",
      address: process.env.CLEARSIG_SWAP_COLLATERAL_VAULT ?? "",
      available: readNumberEnv("CLEARSIG_SWAP_COLLATERAL_USD", 0),
      action: "Fund or record solver collateral before allowing fills.",
    },
  ];
}

function safeValue(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 48) return value;
  return `${value.slice(0, 18)}...${value.slice(-10)}`;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
