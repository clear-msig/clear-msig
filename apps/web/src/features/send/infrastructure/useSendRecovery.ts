"use client";
import { useEffect, useRef, useState } from "react";
import { SendRecovery } from "./sendRecovery";
export function useSendRecovery(scope: string) {
  const [, render] = useState(0);
  const controller = useRef<SendRecovery | null>(null);
  if (!controller.current) {
    let storage: Storage | undefined;
    try {
      if (typeof window !== "undefined") storage = window.sessionStorage;
    } catch {
      /* session storage optional */
    }
    controller.current = new SendRecovery(scope, storage, () =>
      render((value) => value + 1),
    );
  }
  controller.current.scope(scope);
  // Read session storage after mount, preserving server/client hydration parity.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return {
    startSeparateRequest: () => controller.current!.startSeparateRequest(),
    begin: () => controller.current!.begin(),
    saved: mounted ? controller.current.saved() : null,
  };
}
