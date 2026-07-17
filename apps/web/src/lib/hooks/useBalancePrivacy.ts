"use client";

import { useCallback, useEffect, useState } from "react";

const BALANCE_PRIVACY_KEY = "clearsig.balanceHidden";
const BALANCE_PRIVACY_EVENT = "clearsig:balance-privacy";

function readBalanceHidden(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(BALANCE_PRIVACY_KEY) === "1";
}

export function useBalancePrivacy() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sync = () => setHidden(readBalanceHidden());
    sync();
    window.addEventListener(BALANCE_PRIVACY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BALANCE_PRIVACY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !readBalanceHidden();
    window.localStorage.setItem(BALANCE_PRIVACY_KEY, next ? "1" : "0");
    setHidden(next);
    window.dispatchEvent(new Event(BALANCE_PRIVACY_EVENT));
  }, []);

  return { hidden, toggle };
}
