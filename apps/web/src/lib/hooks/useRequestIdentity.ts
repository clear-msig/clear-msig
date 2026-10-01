"use client";
import { useRef } from "react";
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
  const state = useRef({ scope, generation: 0 });
  if (state.current.scope !== scope)
    state.current = { scope, generation: state.current.generation + 1 };
  const generation = state.current.generation;
  return {
    accountKey,
    assertCurrent: () => {
      if (
        state.current.generation !== generation ||
        state.current.scope !== scope
      )
        throw new Error(
          "Account or network changed. Review the existing request before continuing.",
        );
    },
  };
}
