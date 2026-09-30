import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { withAgentWalletStorageScope, agentStorageDeploymentIdentity } from "@/features/agents/server/walletScope";

export const AGENT_TEST_GENESIS_HASH = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
export const agentTestDeploymentIdentity = () => agentStorageDeploymentIdentity(AGENT_TEST_GENESIS_HASH);

/** Explicit synthetic canonical identity for offline domain fixtures only. */
export function agentTestWalletAddress(walletName: string): string {
  return new PublicKey(createHash("sha256").update(walletName).digest()).toBase58();
}

export function withAgentTestWallet<T>(walletName: string, operation: () => Promise<T>): Promise<T> {
  return withAgentWalletStorageScope({ walletName, walletAddress: agentTestWalletAddress(walletName), chainGenesisHash: AGENT_TEST_GENESIS_HASH }, operation);
}
