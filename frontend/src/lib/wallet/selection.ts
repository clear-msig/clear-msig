export interface WalletLike {
  address?: string;
  connector?: {
    key?: string;
    name?: string;
    overrideKey?: string;
  };
}

export function walletConnectorId(wallet: unknown): string {
  const c = (wallet as WalletLike | null)?.connector;
  return (c?.key ?? c?.overrideKey ?? c?.name ?? "").toLowerCase();
}

export function isCompatibleEmbeddedWallet(wallet: unknown): boolean {
  return /(turnkey|embedded|dynamicwaas|waas|email|google|social|auth)/.test(
    walletConnectorId(wallet),
  );
}

export function isLegacyWaasSolanaWallet(wallet: unknown): boolean {
  const connector = walletConnectorId(wallet);
  return /(?:^|[-_ ])(?:dynamic)?waas(?:[-_ ]|$)/.test(connector);
}

export function selectSolanaWallet<T>(
  primaryWallet: T | null | undefined,
  allWallets: readonly T[],
  isSolana: (wallet: T) => boolean,
): T | null {
  if (primaryWallet && isSolana(primaryWallet)) {
    return primaryWallet;
  }
  const compatibleEmbedded = allWallets.find(
    (wallet) => wallet && isSolana(wallet) && isCompatibleEmbeddedWallet(wallet),
  );
  if (compatibleEmbedded) return compatibleEmbedded;
  return allWallets.find((wallet) => wallet && isSolana(wallet)) ?? null;
}
