"use client";

// useSendChains. Maps the wallet's bound chains to "can I send on
// this chain right now?" status.
//
// Every chain a wallet supports has TWO requirements:
//   1. A chain binding (Ika dWallet). Owned by /chains/add.
//   2. A spending intent for that chain's transfer template. Owned
//      by /setup (Solana) or /setup/eth (Ethereum) etc.
//
// /send picks one of these per send. The chain picker uses this hook
// to render tabs and to know whether each tab is "ready to send" or
// "needs setup."
//
// Solana is always available regardless of bindings - the program
// runs on Solana and the vault PDA is derivable client-side. For
// non-Solana chains, both binding + intent must be present.
//
import { useMemo } from "react";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import {
  IntentType,
  type IntentAccount,
} from "@/lib/msig";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { CHAIN_CATALOG, chainByKind, type ChainMeta } from "@/lib/retail/chains";
import type { ChainBindingResponse } from "@/lib/api/types";
import {
  baseChainSendStatus,
  type ChainSendStatus,
} from "@/lib/chain/send-support";

export interface SendChainOption {
  chain: ChainMeta;
  /// Chain-native address for this binding. Always set for Solana
  /// (derived from vault PDA). May be null for non-Solana chains
  /// when the dWallet hasn't finished spinning up.
  address: string | null;
  /// The matching intent for this chain (or null if not set up yet).
  intent: IntentAccount | null;
  /// True if a send can fire today (binding present + intent present
  /// + chain is one of the supported live chains).
  canSend: boolean;
  /// Friendly status string for the picker chip ("Ready", "Set up
  /// sending", "Coming soon"). Drives the badge under the chain
  /// name.
  status: ChainSendStatus;
}

export function useSendChains(walletName: string) {
  const { connection } = useConnection();

  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      return listIntents(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account.intentIndex,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });
  const bindingsQuery = useWalletChains(walletName);

  const customIntents = useMemo<IntentAccount[]>(() => {
    return (intentsQuery.data ?? [])
      .map((it) => it.account)
      .filter(
        (a): a is IntentAccount =>
          a !== null && a.intentType === IntentType.Custom,
      );
  }, [intentsQuery.data]);

  const options = useMemo<SendChainOption[]>(() => {
    const bindingByKind = new Map<number, ChainBindingResponse>();
    for (const b of bindingsQuery.data?.chains ?? []) {
      bindingByKind.set(b.chain_kind, b);
    }

    return CHAIN_CATALOG.map((chain): SendChainOption => {
      // Solana is implicit - the program runs there, no binding row.
      const isSolana = chain.kind === 0;
      const binding = bindingByKind.get(chain.kind) ?? null;
      const hasBinding = isSolana || !!binding;
      const address = isSolana
        ? null // /send already knows it's Solana; no per-row address needed.
        : binding
          ? chainAddress(binding)
          : null;
      const intent =
        customIntents.find((it) => it.chainKind === chain.kind) ?? null;

      let status: SendChainOption["status"];
      const support = baseChainSendStatus(chain.kind);
      if (support === "coming_soon") {
        status = support;
      } else if (!hasBinding) {
        status = "needs_binding";
      } else if (!intent) {
        status = "needs_setup";
      } else {
        status = "ready";
      }
      return {
        chain,
        address,
        intent,
        canSend: status === "ready",
        status,
      };
    });
  }, [bindingsQuery.data, customIntents]);

  return {
    options,
    /// True while any underlying query is in flight. Lets /send
    /// hold rendering the picker until the chain set is stable.
    loading:
      walletQuery.isLoading ||
      intentsQuery.isLoading ||
      bindingsQuery.isLoading,
  };
}

// Re-export so consumers can map a kind back to a ChainMeta without
// a second import.
export { chainByKind };
