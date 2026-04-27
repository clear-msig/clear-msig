// PDA derivations . browser-side mirror of
// programs/clear-wallet/client/src/pda.rs.
//
// All derivations use `PublicKey.findProgramAddressSync` (synchronous .
// no I/O) and are safe to call from any UI context. The seed byte
// strings must match Rust byte-for-byte; if any constant drifts, the
// UI will derive addresses that don't exist on chain and every RPC read
// returns null.

import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@/lib/msig/hash";

// Seed literals . exact byte strings used by the on-chain program.
const SEED_CLEAR_WALLET = new TextEncoder().encode("clear_wallet");
const SEED_VAULT = new TextEncoder().encode("vault");
const SEED_INTENT = new TextEncoder().encode("intent");
const SEED_PROPOSAL = new TextEncoder().encode("proposal");
const SEED_IKA_CONFIG = new TextEncoder().encode("ika_config");
const SEED_DWALLET_OWNERSHIP = new TextEncoder().encode("dwallet_owner");
const SEED_CPI_AUTHORITY = new TextEncoder().encode("__ika_cpi_authority");

/// `["clear_wallet", sha256(name)]`. `name` is the UTF-8 wallet name.
export function findWalletAddress(
  name: string,
  programId: PublicKey
): [PublicKey, number] {
  const nameHash = sha256(new TextEncoder().encode(name));
  return PublicKey.findProgramAddressSync(
    [SEED_CLEAR_WALLET, nameHash],
    programId
  );
}

/// `["vault", wallet]`. The vault PDA is what signs Solana CPIs for
/// Solana-native intents (before the "all chains go through Ika" rework).
export function findVaultAddress(
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_VAULT, wallet.toBytes()],
    programId
  );
}

/// `["intent", wallet, [index]]`.
export function findIntentAddress(
  wallet: PublicKey,
  index: number,
  programId: PublicKey
): [PublicKey, number] {
  if (index < 0 || index > 0xff) {
    throw new Error(`findIntentAddress: index must fit in u8 (got ${index})`);
  }
  return PublicKey.findProgramAddressSync(
    [SEED_INTENT, wallet.toBytes(), new Uint8Array([index])],
    programId
  );
}

/// `["proposal", intent, index_le_bytes]`. `index` is a u64, encoded
/// little-endian . must match `proposal_index.to_le_bytes()` on chain.
export function findProposalAddress(
  intent: PublicKey,
  index: bigint,
  programId: PublicKey
): [PublicKey, number] {
  if (index < 0n || index > 0xffffffffffffffffn) {
    throw new Error(`findProposalAddress: index must fit in u64 (got ${index})`);
  }
  const idxBytes = new Uint8Array(8);
  const dv = new DataView(idxBytes.buffer);
  dv.setBigUint64(0, index, /* littleEndian */ true);
  return PublicKey.findProgramAddressSync(
    [SEED_PROPOSAL, intent.toBytes(), idxBytes],
    programId
  );
}

/// `["ika_config", wallet, [chain_kind]]`.
export function findIkaConfigAddress(
  wallet: PublicKey,
  chainKind: number,
  programId: PublicKey
): [PublicKey, number] {
  if (chainKind < 0 || chainKind > 0xff) {
    throw new Error(
      `findIkaConfigAddress: chainKind must fit in u8 (got ${chainKind})`
    );
  }
  return PublicKey.findProgramAddressSync(
    [SEED_IKA_CONFIG, wallet.toBytes(), new Uint8Array([chainKind])],
    programId
  );
}

/// `["dwallet_owner", dwallet]`. Per-dWallet ownership lock . gates
/// which clear-msig wallet can drive `ika_sign` for this dWallet.
export function findDwalletOwnershipAddress(
  dwallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_DWALLET_OWNERSHIP, dwallet.toBytes()],
    programId
  );
}

/// `["__ika_cpi_authority"]`. Program-wide CPI authority PDA . signs
/// every Ika dWallet CPI and is the on-chain authority of every bound
/// dWallet.
export function findCpiAuthority(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_CPI_AUTHORITY], programId);
}

/// Bundle every wallet-related PDA in one call . convenient for the
/// `/wallet/[name]` detail page which renders all of them.
export interface WalletPdas {
  wallet: PublicKey;
  walletBump: number;
  vault: PublicKey;
  vaultBump: number;
  addIntent: PublicKey;
  removeIntent: PublicKey;
  updateIntent: PublicKey;
}

export function deriveWalletPdas(name: string, programId: PublicKey): WalletPdas {
  const [wallet, walletBump] = findWalletAddress(name, programId);
  const [vault, vaultBump] = findVaultAddress(wallet, programId);
  const [addIntent] = findIntentAddress(wallet, 0, programId);
  const [removeIntent] = findIntentAddress(wallet, 1, programId);
  const [updateIntent] = findIntentAddress(wallet, 2, programId);
  return { wallet, walletBump, vault, vaultBump, addIntent, removeIntent, updateIntent };
}
