"use client";

import type {
  SwapAssetId,
  SwapDraft,
  SwapExecutionReceipt,
  SwapFill,
  SwapQuote,
  SwapReservation,
} from "@/lib/swap/drafts";

export interface SwapQuoteResponse {
  ok: true;
  quote: SwapQuote;
  inventory?: unknown;
  collateral?: unknown;
}

export interface SwapDraftResponse {
  ok: true;
  draft: SwapDraft;
  next: "reserve" | "review_policy";
  collateral?: unknown;
}

export interface SwapExecutionResponse {
  ok: boolean;
  reservation?: SwapReservation;
  fill?: SwapFill;
  receipt: SwapExecutionReceipt;
  readiness: {
    state: "adapter_not_configured" | "ready_for_ika";
    message: string;
  };
}

export interface SwapReserveResponse {
  ok: true;
  reservation: SwapReservation;
}

export interface SwapFillResponse {
  ok: true;
  fill: SwapFill;
}

export interface SwapStatusResponse {
  ok: true;
  fill: SwapFill | null;
  reservation: SwapReservation | null;
}

export function requestSwapQuote(input: {
  from: SwapAssetId;
  to: SwapAssetId;
  amount: string;
}): Promise<SwapQuoteResponse> {
  return swapRequest<SwapQuoteResponse>("/api/swap/quote", input);
}

export function requestSwapDraft(input: {
  walletName: string;
  quote: SwapQuote;
}): Promise<SwapDraftResponse> {
  return swapRequest<SwapDraftResponse>("/api/swap/draft", input);
}

export function requestSwapExecution(input: {
  draft: SwapDraft;
}): Promise<SwapExecutionResponse> {
  return swapRequest<SwapExecutionResponse>("/api/swap/execute", input, {
    acceptConflict: true,
  });
}

export function requestSwapReserve(input: {
  draft: SwapDraft;
}): Promise<SwapReserveResponse> {
  return swapRequest<SwapReserveResponse>("/api/swap/reserve", input, {
    acceptConflict: false,
  });
}

export function requestSwapFill(input: {
  reservationId: string;
}): Promise<SwapFillResponse> {
  return swapRequest<SwapFillResponse>("/api/swap/fill", input, {
    acceptConflict: false,
  });
}

export function requestSwapStatus(id: string): Promise<SwapStatusResponse> {
  return swapGet<SwapStatusResponse>(`/api/swap/status/${encodeURIComponent(id)}`);
}

async function swapRequest<T>(
  path: string,
  body: unknown,
  options?: { acceptConflict?: boolean },
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok && !(options?.acceptConflict && response.status === 409)) {
    throw new Error(json?.error ?? `Swap request failed (${response.status})`);
  }
  if (!json) throw new Error("Swap response was empty.");
  return json as T;
}

async function swapGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "GET",
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(json?.error ?? `Swap request failed (${response.status})`);
  }
  if (!json) throw new Error("Swap response was empty.");
  return json as T;
}
