"use client";
import { useWalletRuntime } from "@/lib/wallet/context";
const blocked = async () => {
  throw new Error("Local fixture: RPC writes/signing are disabled");
};
const connection = new Proxy(
  {
    rpcEndpoint: "http://127.0.0.1:3105/fixture-rpc",
    onAccountChange: () => 1,
    removeAccountChangeListener: async () => {},
    getBalance: async () => 25000000000,
  },
  { get: (o, k) => (k in o ? o[k] : blocked) },
);
export const useWallet = () => useWalletRuntime();
export const useConnection = () => ({ connection });
