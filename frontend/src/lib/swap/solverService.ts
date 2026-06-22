import {
  buildSwapExecutionReceipt,
  buildSwapQuote,
  createSwapDraft,
  enforceSwapPolicy,
  type SwapAssetId,
  type SwapDraft,
  type SwapFill,
  type SwapQuote,
  type SwapReservation,
} from "@/lib/swap/drafts";
import {
  inventoryFor,
  readSolverInventoryConfig,
  type SolverInventoryConfig,
} from "@/lib/swap/inventory";
import {
  solverCollateralForQuote,
  type SolverCollateralVault,
} from "@/lib/swap/collateral";

export interface SolverQuoteResponse {
  ok: true;
  quote: SwapQuote;
  inventory: SolverInventoryConfig;
  collateral: SolverCollateralVault;
}

type Store = {
  reservations: Map<string, SwapReservation>;
  fills: Map<string, SwapFill>;
};

const globalStore = globalThis as typeof globalThis & {
  __clearsigSwapSolverStore?: Store;
};

function store(): Store {
  if (!globalStore.__clearsigSwapSolverStore) {
    globalStore.__clearsigSwapSolverStore = {
      reservations: new Map(),
      fills: new Map(),
    };
  }
  return globalStore.__clearsigSwapSolverStore;
}

export function solverQuote(input: {
  from: SwapAssetId;
  to: SwapAssetId;
  amount: string;
}): SolverQuoteResponse | { ok: false; error: string } {
  const quote = buildSwapQuote(input);
  if (!quote) return { ok: false, error: "Quote is not valid." };
  return {
    ok: true,
    quote,
    inventory: readSolverInventoryConfig(),
    collateral: solverCollateralForQuote(quote),
  };
}

export function solverCreateDraft(input: {
  walletName: string;
  quote: SwapQuote;
}): { ok: true; draft: SwapDraft; collateral: SolverCollateralVault } | { ok: false; error: string } {
  const rebuilt = buildSwapQuote({
    from: input.quote.from,
    to: input.quote.to,
    amount: input.quote.amount,
  });
  if (!rebuilt) return { ok: false, error: "Quote is no longer valid." };
  const draft = createSwapDraft(input.walletName, {
    ...rebuilt,
    id: input.quote.id,
    expiresAt: input.quote.expiresAt,
    intentHash: input.quote.intentHash,
  });
  return {
    ok: true,
    draft,
    collateral: solverCollateralForQuote(draft.quote),
  };
}

export function solverReserve(input: {
  draft: SwapDraft;
}): { ok: true; reservation: SwapReservation } | { ok: false; error: string } {
  const policy = enforceSwapPolicy(input.draft.quote);
  if (!policy.allowed) return { ok: false, error: policy.reason };

  const receiveAmount = Number(input.draft.quote.receiveAmount);
  const receiveAsset = input.draft.quote.to;
  const inventory = inventoryFor(receiveAsset);
  if (!inventory || inventory.available - inventory.reserved < receiveAmount) {
    return {
      ok: false,
      error: `Solver inventory is not enough for ${receiveAsset}.`,
    };
  }

  const collateral = solverCollateralForQuote(input.draft.quote);
  if (collateral.availableUsd < collateral.requiredUsd) {
    return { ok: false, error: collateral.message };
  }

  const reservation: SwapReservation = {
    id: createId("reserve"),
    draft: input.draft,
    receiveAsset,
    receiveAmount,
    expiresAt: Date.now() + 90_000,
    status: "reserved",
    collateral,
  };
  store().reservations.set(reservation.id, reservation);
  return { ok: true, reservation };
}

export function solverFill(input: {
  reservationId: string;
}): { ok: true; fill: SwapFill } | { ok: false; error: string } {
  const reservation = store().reservations.get(input.reservationId);
  if (!reservation) return { ok: false, error: "Reservation not found." };
  if (reservation.expiresAt < Date.now()) {
    reservation.status = "expired";
    return { ok: false, error: "Reservation expired. Request a fresh quote." };
  }

  const receipt = buildSwapExecutionReceipt(reservation.draft);
  const ikaConfigured = isIkaConfigured();
  const fill: SwapFill = {
    id: createId("fill"),
    reservationId: reservation.id,
    status: ikaConfigured ? "awaiting_ika" : "adapter_not_configured",
    receipt: {
      ...receipt,
      status: ikaConfigured ? "ready_for_ika" : "execution_unavailable",
      title: ikaConfigured ? "Ready for Ika signing" : "Ika adapter needed",
      message: ikaConfigured
        ? "Solver reserved liquidity. Ika can now prepare native-chain signing."
        : "Solver reserved the testnet fill, but Ika signing is not configured on this deployment.",
    },
    message: ikaConfigured
      ? "Reserved. Waiting for Ika signing handoff."
      : "Reserved. Configure Ika and solver env to submit the source-chain transaction.",
    updatedAt: Date.now(),
  };
  reservation.status = ikaConfigured ? "reserved" : "blocked";
  store().fills.set(fill.id, fill);
  return { ok: true, fill };
}

export function solverStatus(id: string):
  | { ok: true; fill: SwapFill | null; reservation: SwapReservation | null }
  | { ok: false; error: string } {
  const fill = store().fills.get(id) ?? null;
  const reservation = store().reservations.get(id) ?? null;
  if (!fill && !reservation) return { ok: false, error: "Swap status not found." };

  if (fill && fill.status === "awaiting_ika" && isIkaConfigured()) {
    // Alpha adapter boundary: keep it pending until the real backend/Ika
    // submitter writes source/destination explorer hashes.
    fill.updatedAt = Date.now();
  }
  return { ok: true, fill, reservation };
}

export function isIkaConfigured(): boolean {
  return (
    process.env.CLEARSIG_SWAP_IKA_ENABLED === "1" &&
    !!process.env.CLEARSIG_SWAP_SOLVER_URL &&
    !!process.env.NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID &&
    !!process.env.NEXT_PUBLIC_IKA_GRPC_URL
  );
}

function createId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
