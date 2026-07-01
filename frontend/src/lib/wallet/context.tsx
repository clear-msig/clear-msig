"use client";

import { createContext, useContext } from "react";
import type {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

type SolanaTransaction = Transaction | VersionedTransaction;

export interface WalletValue {
  publicKey: PublicKey | null;
  connected: boolean;
  signMessage?: (
    bytes: Uint8Array,
    preferSigner?: PublicKey | null,
  ) => Promise<Uint8Array>;
  signTransaction?: <T extends SolanaTransaction>(tx: T) => Promise<T>;
  disconnect: () => Promise<void>;
  connecting: boolean;
  disconnecting: boolean;
  loggedInWithoutSolana: boolean;
  isLedger: boolean;
  isUnsupportedSigner: boolean;
  isLossySigner: boolean;
  signerIssue: "waas" | null;
  isPhantomWallet: boolean;
  isMobile: boolean;
  dynamicPublicKey: PublicKey | null;
  ledgerPublicKey: PublicKey | null;
  pickSigner: (approvers: readonly string[]) => PublicKey | null;
}

export const disconnectedWalletValue: WalletValue = {
  publicKey: null,
  connected: false,
  disconnect: async () => {},
  connecting: false,
  disconnecting: false,
  loggedInWithoutSolana: false,
  isLedger: false,
  isUnsupportedSigner: false,
  isLossySigner: false,
  signerIssue: null,
  isPhantomWallet: false,
  isMobile: false,
  dynamicPublicKey: null,
  ledgerPublicKey: null,
  pickSigner: () => null,
};

const WalletRuntimeContext = createContext<WalletValue>(disconnectedWalletValue);

export function WalletRuntimeProvider({
  value,
  children,
}: {
  value: WalletValue;
  children: React.ReactNode;
}) {
  return (
    <WalletRuntimeContext.Provider value={value}>
      {children}
    </WalletRuntimeContext.Provider>
  );
}

export function useWalletRuntime() {
  return useContext(WalletRuntimeContext);
}
