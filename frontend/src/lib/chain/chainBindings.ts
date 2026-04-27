// Direct-RPC reader for IkaConfig PDAs (per-(wallet, chain_kind) dWallet
// bindings). Scans chain_kinds 0..=4 in parallel via one batched
// `getMultipleAccountsInfo` . single RPC roundtrip.
//
// Supported chain_kinds (mirrors programs/clear-wallet/src/chains/mod.rs::
// ChainKind):
//   0 = Solana (via Ika Curve25519 dWallet)
//   1 = EVM 1559
//   2 = Bitcoin P2WPKH
//   3 = Zcash transparent
//   4 = EVM 1559 ERC-20

import { Connection, PublicKey } from "@solana/web3.js";
import {
  findIkaConfigAddress,
  parseIkaConfig,
  type IkaConfigAccount,
} from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";

/// Human-readable names keyed by chain_kind byte. Source of truth is
/// the Rust `ChainKindJson` enum.
export const CHAIN_KIND_LABELS: Readonly<Record<number, string>> = {
  0: "solana",
  1: "evm_1559",
  2: "bitcoin_p2wpkh",
  3: "zcash_transparent",
  4: "evm_1559_erc20",
};

export interface ChainBindingWithPda {
  pda: PublicKey;
  chainKind: number;
  chainLabel: string;
  account: IkaConfigAccount;
}

/// List every IkaConfig binding this wallet has. Returns only the
/// chain_kinds that have been bound; missing / not-yet-bound chains are
/// filtered out.
export async function listChainBindings(
  connection: Connection,
  wallet: PublicKey
): Promise<ChainBindingWithPda[]> {
  const probes = [0, 1, 2, 3, 4].map((ck) => {
    const [pda] = findIkaConfigAddress(wallet, ck, CLEAR_WALLET_PROGRAM_ID);
    return { pda, chainKind: ck };
  });

  const accounts = await connection.getMultipleAccountsInfo(
    probes.map((p) => p.pda),
    DEFAULT_COMMITMENT
  );

  const out: ChainBindingWithPda[] = [];
  for (let i = 0; i < probes.length; i++) {
    const info = accounts[i];
    if (!info) continue;
    try {
      out.push({
        pda: probes[i].pda,
        chainKind: probes[i].chainKind,
        chainLabel: CHAIN_KIND_LABELS[probes[i].chainKind] ?? `chain_${probes[i].chainKind}`,
        account: parseIkaConfig(new Uint8Array(info.data)),
      });
    } catch {
      // PDA with the same address but a different discriminator . skip.
    }
  }
  return out;
}
