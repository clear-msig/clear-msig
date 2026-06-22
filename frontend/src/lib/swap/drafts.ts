"use client";

import { CHAIN_CATALOG, type ChainMeta } from "@/lib/retail/chains";

export type SwapAssetId = "SOL" | "ETH" | "BTC" | "ZEC" | "HYPE";

export interface SwapAsset {
  id: SwapAssetId;
  chain: ChainMeta;
  phase: "testnet-ready" | "later";
}

export interface SwapPolicyCheck {
  id: "amount" | "slippage" | "route" | "replay" | "privacy";
  label: string;
  passed: boolean;
  detail: string;
}

export interface SwapQuote {
  id: string;
  mode: "testnet-mock";
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
}

export interface SwapDraft {
  id: string;
  walletName: string;
  quote: SwapQuote;
  createdAt: number;
  status: "draft";
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

  return {
    id: createDraftId(),
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
  const draft: SwapDraft = {
    id: quote.id,
    walletName,
    quote,
    createdAt: Date.now(),
    status: "draft",
  };
  const existing = listSwapDrafts().filter((item) => item.id !== draft.id);
  writeDrafts([draft, ...existing].slice(0, 16));
  return draft;
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
      passed: routeReady,
      detail: routeReady
        ? "This pair can use the mocked public testnet route."
        : "This asset stays hidden from execution until the route is live.",
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
    draft.status === "draft" &&
    typeof draft.createdAt === "number" &&
    !!draft.quote &&
    typeof draft.quote === "object"
  );
}
