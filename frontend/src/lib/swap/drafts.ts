import { CHAIN_CATALOG, type ChainMeta } from "@/lib/retail/chains";

export type SwapAssetId = "SOL" | "ETH" | "BTC" | "ZEC" | "HYPE";
export type SwapMode = "testnet-mock";
export type SwapExecutionStatus =
  | "draft"
  | "policy_checked"
  | "execution_unavailable"
  | "ready_for_ika"
  | "executed";

export interface SwapAsset {
  id: SwapAssetId;
  chain: ChainMeta;
  phase: "testnet-ready" | "later";
}

export interface SwapPolicyCheck {
  id: "amount" | "slippage" | "route" | "solver" | "replay" | "privacy";
  label: string;
  passed: boolean;
  detail: string;
}

export interface SwapQuote {
  id: string;
  mode: SwapMode;
  from: SwapAssetId;
  to: SwapAssetId;
  amount: string;
  amountUsd: number;
  receiveAmount: string;
  minReceiveAmount: string;
  maxLossBps: number;
  feeUsd: number;
  etaSeconds: number;
  route: string[];
  solver: {
    name: string;
    status: "allowlisted" | "demo" | "research";
  };
  policyChecks: SwapPolicyCheck[];
  expiresAt: number;
  intentHash: string;
}

export interface SwapDraft {
  id: string;
  walletName: string;
  quote: SwapQuote;
  createdAt: number;
  status: "draft" | "policy_checked";
  nonce: string;
  policyDecision: SwapPolicyDecision;
}

export interface SwapPolicyDecision {
  allowed: boolean;
  checks: SwapPolicyCheck[];
  reason: string;
}

export interface SwapExecutionReceipt {
  id: string;
  draftId: string;
  status: SwapExecutionStatus;
  title: string;
  message: string;
  sourceExplorerUrl: string | null;
  destinationExplorerUrl: string | null;
  route: string[];
  privatePolicy: {
    state: "prototype" | "live";
    message: string;
  };
}

export interface SwapReservation {
  id: string;
  draft: SwapDraft;
  receiveAsset: SwapAssetId;
  receiveAmount: number;
  expiresAt: number;
  status: "reserved" | "expired" | "filled" | "blocked";
  collateral: {
    state: "configured" | "dev-placeholder";
    solverId: string;
    vaultAddress: string;
    requiredUsd: number;
    availableUsd: number;
    message: string;
  };
}

export interface SwapFill {
  id: string;
  reservationId: string;
  status:
    | "awaiting_ika"
    | "adapter_not_configured"
    | "submitted"
    | "settled"
    | "blocked";
  receipt: SwapExecutionReceipt;
  message: string;
  updatedAt: number;
}

const STORAGE_KEY = "clearsig.swap.drafts.v1";

const PRICE_USD: Record<SwapAssetId, number> = {
  SOL: 143,
  ETH: 3400,
  BTC: 64000,
  ZEC: 28,
  HYPE: 34,
};

const TESTNET_READY = new Set<SwapAssetId>(["SOL", "ETH", "BTC"]);
const ALLOWED_PUBLIC_ROUTES = new Set(["BTC:SOL", "SOL:BTC", "ETH:SOL", "SOL:ETH"]);

export const SWAP_ASSETS: SwapAsset[] = CHAIN_CATALOG.map((chain) => ({
  id: chain.ticker as SwapAssetId,
  chain,
  phase: TESTNET_READY.has(chain.ticker as SwapAssetId)
    ? "testnet-ready"
    : "later",
})).filter((asset): asset is SwapAsset =>
  ["SOL", "ETH", "BTC", "ZEC", "HYPE"].includes(asset.id),
);

export function swapAsset(id: SwapAssetId): SwapAsset {
  return SWAP_ASSETS.find((asset) => asset.id === id) ?? SWAP_ASSETS[0];
}

export function buildSwapQuote({
  from,
  to,
  amount,
}: {
  from: SwapAssetId;
  to: SwapAssetId;
  amount: string;
}): SwapQuote | null {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0 || from === to) return null;

  const amountUsd = parsed * PRICE_USD[from];
  const feeUsd = Math.max(amountUsd * 0.0035, 0.02);
  const receiveUsd = Math.max(amountUsd - feeUsd, 0);
  const receiveAmount = receiveUsd / PRICE_USD[to];
  const minReceiveAmount = receiveAmount * 0.995;
  const policyChecks = buildPolicyChecks({ from, to, amountUsd });
  const solver = selectSolver(from, to, amountUsd);
  const id = createDraftId();
  const expiresAt = Date.now() + 2 * 60_000;

  return {
    id,
    mode: "testnet-mock",
    from,
    to,
    amount: trimAmount(parsed, 8),
    amountUsd,
    receiveAmount: trimAmount(receiveAmount, 8),
    minReceiveAmount: trimAmount(minReceiveAmount, 8),
    maxLossBps: 50,
    feeUsd,
    etaSeconds: solver.status === "allowlisted" ? 120 : 180,
    route: [
      "ClearSig policy check",
      "Ika native signing",
      "Testnet settlement",
    ],
    solver,
    policyChecks,
    expiresAt,
    intentHash: buildIntentHash({ id, from, to, amount: trimAmount(parsed, 8) }),
  };
}

export function quoteIsExecutable(quote: SwapQuote | null): quote is SwapQuote {
  return Boolean(
    quote &&
      quote.solver.status === "allowlisted" &&
      quote.policyChecks.every((check) => check.passed),
  );
}

export function saveSwapDraft(
  walletName: string,
  quote: SwapQuote,
): SwapDraft {
  const policyDecision = enforceSwapPolicy(quote);
  const draft: SwapDraft = {
    id: quote.id,
    walletName,
    quote,
    createdAt: Date.now(),
    status: policyDecision.allowed ? "policy_checked" : "draft",
    nonce: createDraftId(),
    policyDecision,
  };
  const existing = listSwapDrafts().filter((item) => item.id !== draft.id);
  writeDrafts([draft, ...existing].slice(0, 16));
  return draft;
}

export function storeSwapDraft(draft: SwapDraft): SwapDraft {
  const existing = listSwapDrafts().filter((item) => item.id !== draft.id);
  writeDrafts([draft, ...existing].slice(0, 16));
  return draft;
}

export function createSwapDraft(
  walletName: string,
  quote: SwapQuote,
): SwapDraft {
  const policyDecision = enforceSwapPolicy(quote);
  return {
    id: quote.id,
    walletName,
    quote,
    createdAt: Date.now(),
    status: policyDecision.allowed ? "policy_checked" : "draft",
    nonce: createDraftId(),
    policyDecision,
  };
}

export function enforceSwapPolicy(quote: SwapQuote): SwapPolicyDecision {
  const checks = buildPolicyChecks({
    from: quote.from,
    to: quote.to,
    amountUsd: quote.amountUsd,
  });
  const solverReady = quote.solver.status === "allowlisted";
  const withSolver = checks.map((check) =>
    check.id === "solver"
      ? {
          ...check,
          passed: solverReady,
          detail: solverReady
            ? "Solver is allowlisted for this testnet route."
            : "Solver is not allowlisted for execution yet.",
        }
      : check,
  );
  const allowed = withSolver.every((check) => check.passed);
  return {
    allowed,
    checks: withSolver,
    reason: allowed
      ? "Policy passed. Ready for backend and Ika execution wiring."
      : "Policy did not pass. Keep this as a draft.",
  };
}

export function buildSwapExecutionReceipt(draft: SwapDraft): SwapExecutionReceipt {
  const ready = draft.policyDecision.allowed;
  return {
    id: createDraftId(),
    draftId: draft.id,
    status: ready ? "ready_for_ika" : "execution_unavailable",
    title: ready ? "Execution draft ready" : "Execution blocked",
    message: ready
      ? "Backend quote verification, on-chain policy enforcement, and Ika signing are the next live adapters for this route."
      : draft.policyDecision.reason,
    sourceExplorerUrl: null,
    destinationExplorerUrl: null,
    route: ready
      ? [
          "Backend verifies quote",
          "Solana program enforces policy",
          "Ika signs source-chain transaction",
          "Backend broadcasts and records receipt",
        ]
      : ["Fix the blocked policy check before execution."],
    privatePolicy: {
      state: "prototype",
      message:
        "Private amount, slippage, and route policy are marked for Encrypt integration after public settlement is stable.",
    },
  };
}

export function listSwapDrafts(walletName?: string): SwapDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const drafts = parsed.filter(isSwapDraft);
    return walletName
      ? drafts.filter((draft) => draft.walletName === walletName)
      : drafts;
  } catch {
    return [];
  }
}

function buildPolicyChecks({
  from,
  to,
  amountUsd,
}: {
  from: SwapAssetId;
  to: SwapAssetId;
  amountUsd: number;
}): SwapPolicyCheck[] {
  const routeReady =
    swapAsset(from).phase === "testnet-ready" &&
    swapAsset(to).phase === "testnet-ready";
  return [
    {
      id: "amount",
      label: "Amount",
      passed: amountUsd <= 25_000,
      detail:
        amountUsd <= 25_000
          ? "Inside the MVP swap cap."
          : "Above the MVP cap. Needs extra approvals before execution.",
    },
    {
      id: "slippage",
      label: "Max loss",
      passed: true,
      detail: "Capped at 0.5% before approval.",
    },
    {
      id: "route",
      label: "Route",
      passed: routeReady && ALLOWED_PUBLIC_ROUTES.has(`${from}:${to}`),
      detail: routeReady
        ? ALLOWED_PUBLIC_ROUTES.has(`${from}:${to}`)
          ? "This pair can use the public testnet route."
          : "This pair is visible for planning but not execution yet."
        : "This asset stays hidden from execution until the route is live.",
    },
    {
      id: "solver",
      label: "Solver",
      passed: routeReady,
      detail: routeReady
        ? "Solver allowlist checked before draft execution."
        : "Solver unavailable until route is live.",
    },
    {
      id: "replay",
      label: "Replay",
      passed: true,
      detail: "Each draft gets a unique quote id before signing.",
    },
    {
      id: "privacy",
      label: "Private policy",
      passed: true,
      detail: "Encrypt policy checks come after public settlement is stable.",
    },
  ];
}

function selectSolver(
  from: SwapAssetId,
  to: SwapAssetId,
  amountUsd: number,
): SwapQuote["solver"] {
  if (!TESTNET_READY.has(from) || !TESTNET_READY.has(to)) {
    return { name: "PC-Swap research", status: "research" };
  }
  if (amountUsd > 25_000) {
    return { name: "ClearSig solver", status: "demo" };
  }
  return { name: "ClearSig testnet solver", status: "allowlisted" };
}

function writeDrafts(drafts: SwapDraft[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function createDraftId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  return `${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}`;
}

function buildIntentHash(input: {
  id: string;
  from: SwapAssetId;
  to: SwapAssetId;
  amount: string;
}): string {
  const raw = `${input.id}:${input.from}:${input.to}:${input.amount}:clearsig-swap-v1`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `swap_${hash.toString(16).padStart(8, "0")}`;
}

function trimAmount(value: number, decimals: number): string {
  return value
    .toFixed(decimals)
    .replace(/\.?0+$/, "")
    .replace(/^0$/, "0");
}

function isSwapDraft(value: unknown): value is SwapDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SwapDraft>;
  return (
    typeof draft.id === "string" &&
    typeof draft.walletName === "string" &&
    (draft.status === "draft" || draft.status === "policy_checked") &&
    typeof draft.nonce === "string" &&
    typeof draft.createdAt === "number" &&
    !!draft.quote &&
    typeof draft.quote === "object"
  );
}
