"use client";

// Subscribe to the active display currency. Components that show
// a fiat value re-read on every change so a user toggling between
// USD and EUR sees the new symbol/locale immediately, no reload.
//
// Returned object:
//   currency  — the active code (USD / EUR / ...)
//   format    — pre-bound formatFiat that uses the live pref. Saves
//               every call site from passing `currency` through.
//   formatLamports — same convenience for chain-native amounts.

import { useEffect, useState, useCallback } from "react";
import {
  formatFiat,
  getDisplayCurrency,
  lamportsToFiat,
  subscribeDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/retail/priceConversion";

export interface UseDisplayCurrencyResult {
  currency: DisplayCurrency;
  format: (usd: number) => string;
  formatLamports: (
    amount: bigint,
    smallestPerWhole: bigint,
    ticker: string,
  ) => string;
}

export function useDisplayCurrency(): UseDisplayCurrencyResult {
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");

  useEffect(() => {
    setCurrency(getDisplayCurrency());
    return subscribeDisplayCurrency(() => setCurrency(getDisplayCurrency()));
  }, []);

  const format = useCallback(
    (usd: number) => formatFiat(usd, currency),
    [currency],
  );
  const formatLamports = useCallback(
    (amount: bigint, smallestPerWhole: bigint, ticker: string) =>
      lamportsToFiat(amount, smallestPerWhole, ticker, currency),
    [currency],
  );

  return { currency, format, formatLamports };
}
