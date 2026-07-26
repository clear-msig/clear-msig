"use client";

// useRampIntent - polls a single ramp intent until it reaches a
// terminal status, then stops polling.
//
// React Query's `refetchInterval` accepts a function that returns
// `false` to stop polling - we use that to halt as soon as the intent
// hits one of the terminal statuses (`payout_completed`, `failed`,
// `cancelled`, `expired`, `manual_review_required`).

import { useQuery } from "@tanstack/react-query";
import { rampApi } from "@/lib/ramp/client";
import { TERMINAL_STATUSES, type IntentDetailResponse } from "@/lib/ramp/types";

export function useRampIntent(
  pubkey: string | null,
  intentId: string | null,
  options?: { intervalMs?: number },
) {
  const interval = options?.intervalMs ?? 3500;

  return useQuery<IntentDetailResponse>({
    queryKey: ["ramp-intent", pubkey, intentId],
    queryFn: () => {
      if (!pubkey || !intentId) {
        throw new Error("missing pubkey or intentId");
      }
      return rampApi.getIntent(pubkey, intentId);
    },
    enabled: Boolean(pubkey && intentId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return interval;
      if (TERMINAL_STATUSES.includes(status)) return false;
      return interval;
    },
    // Keep last good data while polling so the UI doesn't flicker
    // between "loading…" and a freshly-fetched value.
    refetchOnWindowFocus: false,
  });
}
