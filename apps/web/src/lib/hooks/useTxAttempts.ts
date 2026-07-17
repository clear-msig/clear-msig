"use client";

// React subscription on the localStorage tx-attempt log.
//
// Wraps lib/retail/txLog so components can render the most recent
// send-success/send-failure rows for a wallet without re-reading
// localStorage on every render. Updates immediately when a new
// attempt is recorded in the same tab (custom event) or in another
// tab (native `storage` event).

import { useEffect, useState } from "react";
import { listAttempts, subscribe, type TxAttempt } from "@/lib/retail/txLog";

export function useTxAttempts(walletName: string, limit?: number): TxAttempt[] {
  const [rows, setRows] = useState<TxAttempt[]>([]);

  useEffect(() => {
    if (!walletName) {
      setRows([]);
      return;
    }
    const refresh = () => setRows(listAttempts(walletName, limit));
    refresh();
    return subscribe(refresh);
  }, [walletName, limit]);

  return rows;
}
