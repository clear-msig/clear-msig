"use client";

// Recent on-chain transaction history for a wallet's per-chain
// addresses.
//
// Today the dashboard's `useRecentActivity` covers proposal-level
// events (created / approved / executed) - that's the multisig
// log. This hook covers the chain layer: actual SOL movement on
// the vault PDA, ETH movement on the dWallet's EVM address, etc.
// They're complementary; modern wallets ship both ("activity"
// across the whole wallet life, plus chain-native tx history per
// address).
//
// V1 ships Solana only via `connection.getSignaturesForAddress`.
// EVM (Etherscan API), Bitcoin (mempool.space), and Zcash come in
// follow-ups - each chain's source has its own rate-limit / API-
// key story.

import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection } from "@/lib/wallet";
import { fetchEvmTxHistory } from "@/lib/chain/eth";
import { fetchBitcoinTxHistory } from "@/lib/chain/btc";
import { fetchZcashTxHistory } from "@/lib/chain/zcash";

interface ChainTxHistoryOptions {
  enabled?: boolean;
}

export interface ChainTxRow {
  /// Chain-native tx identifier (Solana signature, EVM tx hash,
  /// BTC txid). Keys the React list and powers the explorer link.
  txId: string;
  /// Unix seconds at which the chain confirmed the tx, when
  /// available. Solana's getSignaturesForAddress returns blockTime
  /// for finalised txs; pending txs have null. Use ts ?? slot to
  /// sort.
  ts: number | null;
  /// Block / slot - fallback ordering when ts is null.
  slot: number;
  /// Status - "confirmed" / "finalized" / "failed".
  status: "confirmed" | "finalized" | "failed";
  /// Raw error string when status is "failed". Most-failures-with-
  /// no-info is just `"err":{"InstructionError": [0, "Custom(N)"]}`
  /// - we stringify and let callers decide how much to show.
  errorBrief: string | null;
}

export function useSolanaTxHistory(
  address: string | null,
  limit: number = 10,
  options: ChainTxHistoryOptions = {},
) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["chain-tx-history-solana", address ?? "", limit],
    queryFn: async (): Promise<ChainTxRow[]> => {
      if (!address) return [];
      const sigs = await fetchSolanaSignatures(
        connection,
        new PublicKey(address),
        limit,
      );
      return sigs;
    },
    enabled: (options.enabled ?? true) && !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

async function fetchSolanaSignatures(
  connection: Connection,
  address: PublicKey,
  limit: number,
): Promise<ChainTxRow[]> {
  const items = await connection.getSignaturesForAddress(address, { limit });
  return items.map((sig) => ({
    txId: sig.signature,
    ts: typeof sig.blockTime === "number" ? sig.blockTime : null,
    slot: sig.slot,
    status:
      sig.err !== null
        ? "failed"
        : sig.confirmationStatus === "finalized"
          ? "finalized"
          : "confirmed",
    errorBrief:
      sig.err !== null
        ? typeof sig.err === "string"
          ? sig.err
          : JSON.stringify(sig.err).slice(0, 120)
        : null,
  }));
}

// ── EVM (Blockscout) ─────────────────────────────────────────────

export function useEvmTxHistory(
  address: string | null,
  limit: number = 10,
  options: ChainTxHistoryOptions = {},
) {
  return useQuery({
    queryKey: ["chain-tx-history-evm", address ?? "", limit],
    queryFn: async (): Promise<ChainTxRow[]> => {
      if (!address) return [];
      const rows = await fetchEvmTxHistory(address, limit);
      return rows.map((r) => ({
        txId: r.hash,
        ts: r.timestamp || null,
        slot: r.blockNumber,
        status: r.status === "failed" ? "failed" : "confirmed",
        errorBrief: r.errorBrief,
      }));
    },
    enabled: (options.enabled ?? true) && !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ── Bitcoin (mempool.space) ──────────────────────────────────────

export function useBitcoinTxHistory(
  address: string | null,
  limit: number = 10,
  options: ChainTxHistoryOptions = {},
) {
  return useQuery({
    queryKey: ["chain-tx-history-btc", address ?? "", limit],
    queryFn: async (): Promise<ChainTxRow[]> => {
      if (!address) return [];
      const rows = await fetchBitcoinTxHistory(address, limit);
      return rows.map((r) => ({
        txId: r.txId,
        ts: r.blockTime,
        slot: r.blockHeight ?? 0,
        status: r.confirmed ? "confirmed" : "confirmed", // BTC pending is still "confirmed" enough for our UI
        errorBrief: null,
      }));
    },
    enabled: (options.enabled ?? true) && !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ── Zcash (zcashd RPC) ──────────────────────────────────────────

export function useZcashTxHistory(
  address: string | null,
  rpcUrl: string,
  limit: number = 10,
  options: ChainTxHistoryOptions = {},
) {
  return useQuery({
    queryKey: ["chain-tx-history-zcash", address ?? "", rpcUrl, limit],
    queryFn: async (): Promise<ChainTxRow[]> => {
      if (!address) return [];
      const rows = await fetchZcashTxHistory(rpcUrl, address, limit);
      return rows.map((r) => ({
        txId: r.txId,
        ts: r.blockTime,
        slot: r.blockHeight ?? 0,
        status: r.confirmed ? "confirmed" : "confirmed",
        errorBrief: null,
      }));
    },
    enabled:
      (options.enabled ?? true) && !!address && rpcUrl.trim().length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
