"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  WalletRuntimeProvider,
  disconnectedWalletValue,
} from "@/lib/wallet/context";
import { fixtureQuery, member } from "./data";
const reject = async () => {
  throw new Error(
    "Local fixture rejected signing: nothing was signed or submitted.",
  );
};
const publicKey = new PublicKey(member);
const wallet = {
  ...disconnectedWalletValue,
  sessionSubject: "fixture-only-subject",
  publicKey,
  dynamicPublicKey: publicKey,
  connected: true,
  signMessage: reject,
  signTransaction: reject,
  disconnect: reject,
  pickSigner: (approvers) => (approvers.includes(member) ? publicKey : null),
};
export default function ConnectedProvider({ children }) {
  const state =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("fixtureState");
  const identity =
    state === "signed-out" || state === "auth-delayed"
      ? disconnectedWalletValue
      : wallet;
  const [client] = useState(() => {
    const c = new QueryClient();
    const defaults = c.defaultQueryOptions.bind(c);
    c.defaultQueryOptions = (options) =>
      defaults({
        ...options,
        queryFn: () => fixtureQuery(options.queryKey),
        retry: false,
        staleTime: Infinity,
        refetchInterval: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      });
    return c;
  });
  return (
    <QueryClientProvider client={client}>
      <WalletRuntimeProvider value={identity}>
        <div
          data-connected-fixture="true"
          role="note"
          className="fixed bottom-0 inset-x-0 z-[999] bg-black px-4 py-2 text-center text-xs text-white"
        >
          LOCAL FIXTURE · Synthetic connected account · Signing and all live
          submissions disabled
        </div>
        {children}
      </WalletRuntimeProvider>
    </QueryClientProvider>
  );
}
