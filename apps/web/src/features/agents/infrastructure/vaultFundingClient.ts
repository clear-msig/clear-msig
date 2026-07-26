import type { Connection, PublicKey } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { findVaultAddress } from "@/lib/msig";
import { resolveWalletProductSurface } from "@/lib/productWorkspace";

export async function loadAgentVaultAddress(
  connection: Connection,
  walletName: string,
  creatorCandidate: PublicKey | null,
): Promise<string | null> {
  const direct = creatorCandidate
    ? await fetchWalletByName(connection, walletName, creatorCandidate)
    : null;
  const wallet = direct ?? (await fetchWalletByName(connection, walletName));
  if (!wallet) return null;
  return findVaultAddress(wallet.pda, CLEAR_WALLET_PROGRAM_ID)[0].toBase58();
}

export async function loadProFundingSources(
  ownerAddress: string,
  agentVaultName: string,
): Promise<string[]> {
  if (!ownerAddress) return [];
  const memberships = await fetchOnchainMemberships(ownerAddress);
  return memberships
    .map((membership) => membership.wallet_name?.trim() ?? "")
    .filter(
      (walletName) =>
        walletName.length > 0 &&
        walletName !== agentVaultName &&
        resolveWalletProductSurface(walletName) === "pro",
    );
}
