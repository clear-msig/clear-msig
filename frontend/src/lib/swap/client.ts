"use client";

import type {
  SwapAssetId,
  SwapDraft,
  SwapExecutionReceipt,
  SwapQuote,
} from "@/lib/swap/drafts";

export interface SwapQuoteResponse {
  ok: true;
  quote: SwapQuote;
}

export interface SwapDraftResponse {
  ok: true;
  draft: SwapDraft;
  next: "execute" | "review_policy";
}

export interface SwapExecutionResponse {
  ok: boolean;
  receipt: SwapExecutionReceipt;
  readiness: {
    state: "adapter_not_configured" | "ready_for_ika";
    message: string;
  };
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
