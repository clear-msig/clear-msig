"use client";
import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@/lib/wallet";
import { requestAccountKey } from "@/lib/clearsign/requestIdentity";
export function useRequestIdentity() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const accountKey = requestAccountKey(
    wallet.sessionSubject,
    wallet.publicKey?.toBase58() ?? null,
  );
  const scope = JSON.stringify([accountKey, connection.rpcEndpoint]);
  const state = useRef({
    scope,
    scopeGeneration: 0,
    lifecycleGeneration: 0,
    active: true,
  });
  if (state.current.scope !== scope) {
    state.current.scope = scope;
    state.current.scopeGeneration += 1;
  }
  const scopeGeneration = state.current.scopeGeneration;
  useEffect(() => {
    const lifecycle = state.current;
    lifecycle.active = true;
    return () => {
      lifecycle.active = false;
      lifecycle.lifecycleGeneration += 1;
    };
  }, []);
  return {
    accountKey,
    capture: () => {
      const lifecycleGeneration = state.current.lifecycleGeneration;
      const assertCurrent = () => {
        if (
          !state.current.active ||
          state.current.scopeGeneration !== scopeGeneration ||
          state.current.scope !== scope ||
          state.current.lifecycleGeneration !== lifecycleGeneration
        )
          throw new Error(
            "Account, network, or page changed. Review the existing request before continuing.",
          );
      };
      assertCurrent();
      return { accountKey, assertCurrent };
    },
  };
}
