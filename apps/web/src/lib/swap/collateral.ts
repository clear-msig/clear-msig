import type { SwapQuote } from "@/lib/swap/drafts";

export interface SolverCollateralVault {
  state: "configured" | "dev-placeholder";
  solverId: string;
  vaultAddress: string;
  requiredUsd: number;
  availableUsd: number;
  message: string;
}

export function solverCollateralForQuote(quote: SwapQuote): SolverCollateralVault {
  const solverId = process.env.CLEARSIG_SWAP_SOLVER_ID ?? quote.solver.name;
  const vaultAddress =
    process.env.CLEARSIG_SWAP_COLLATERAL_VAULT ??
    `devnet-collateral:${solverId}`;
  const availableUsd = readNumberEnv("CLEARSIG_SWAP_COLLATERAL_USD", 50_000);
  const requiredUsd = Math.max(quote.amountUsd * 1.1, 100);
  const configured = !!process.env.CLEARSIG_SWAP_COLLATERAL_VAULT;

  return {
    state: configured ? "configured" : "dev-placeholder",
    solverId,
    vaultAddress,
    requiredUsd,
    availableUsd,
    message:
      availableUsd >= requiredUsd
        ? "Solver collateral covers this testnet fill."
        : "Solver collateral is below the required reserve.",
  };
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
