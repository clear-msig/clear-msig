import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export interface AgentWalletStorageScope {
  walletAddress: string;
  walletName: string;
  chainGenesisHash: string;
}

const scopes = new AsyncLocalStorage<Readonly<AgentWalletStorageScope>>();

export function agentStorageDeploymentIdentity(chainGenesisHash = scopes.getStore()?.chainGenesisHash): { programId: string; network: string } {
  if (!chainGenesisHash || new PublicKey(chainGenesisHash).toBase58() !== chainGenesisHash) {
    throw new Error("Verified chain genesis identity is required for agent persistence.");
  }
  return {
    programId: process.env.NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID ?? "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v",
    network: `solana-genesis:${chainGenesisHash}`,
  };
}

/** Called only after authoritative canonical wallet resolution at the route. */
export function withAgentWalletStorageScope<T>(
  scope: AgentWalletStorageScope,
  callback: () => Promise<T>,
): Promise<T> {
  const walletAddress = new PublicKey(scope.walletAddress).toBase58();
  agentStorageDeploymentIdentity(scope.chainGenesisHash);
  if (walletAddress !== scope.walletAddress || !scope.walletName.trim()) {
    throw new Error("Canonical agent wallet storage identity is invalid.");
  }
  return scopes.run(Object.freeze({ walletAddress, walletName: scope.walletName.trim(), chainGenesisHash: scope.chainGenesisHash }), callback);
}

export function agentWalletStorageKey(walletName: string, kind: string, parts: readonly string[] = []): string {
  const scope = scopes.getStore();
  if (!scope || scope.walletName !== walletName.trim()) {
    throw new Error("Verified canonical wallet scope is required for agent persistence.");
  }
  // Pin namespaces to verified genesis and program. Provider/API-key changes
  // do not change wallet ownership or create a new data namespace.
  const deployment = agentStorageDeploymentIdentity();
  const digest = createHash("sha256").update(JSON.stringify([
    "clearsig.agent.storage.v2", deployment, scope.walletAddress, kind, parts,
  ])).digest("hex");
  return `agent:v2:${kind}:${digest}`;
}
