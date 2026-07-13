export interface WalletLike {
  address?: string;
  connector?: {
    key?: string;
    name?: string;
    overrideKey?: string;
  };
}

export type WalletSelectionPreference = "primary" | "embedded" | "external";

export function walletConnectorId(wallet: unknown): string {
  const c = (wallet as WalletLike | null)?.connector;
  return (c?.key ?? c?.overrideKey ?? c?.name ?? "").toLowerCase();
}

export function isCompatibleEmbeddedWallet(wallet: unknown): boolean {
  return /(turnkey|embedded|dynamicwaas|waas|email|google|social|auth)/.test(
    walletConnectorId(wallet),
  );
}

export function isExternalWallet(wallet: unknown): boolean {
  const connectorId = walletConnectorId(wallet);
  return connectorId.length > 0 && !isCompatibleEmbeddedWallet(wallet);
}

export function connectedWalletRuntime(
  primaryWallet: unknown,
  allWallets: readonly unknown[],
): "embedded" | "external" {
  if (walletConnectorId(primaryWallet)) {
    return isExternalWallet(primaryWallet) ? "external" : "embedded";
  }
  const identifiedWallets = allWallets.filter((wallet) => walletConnectorId(wallet));
  if (
    identifiedWallets.length > 0 &&
    identifiedWallets.every((wallet) => isExternalWallet(wallet))
  ) {
    return "external";
  }
  return "embedded";
}

export function selectSolanaWallet<T>(
  primaryWallet: T | null | undefined,
  allWallets: readonly T[],
  isSolana: (wallet: T) => boolean,
  preference: WalletSelectionPreference = "primary",
): T | null {
  const solanaWallets = allWallets.filter(
    (wallet) => wallet && isSolana(wallet),
  );
  if (preference === "embedded") {
    const embedded = solanaWallets.find(isCompatibleEmbeddedWallet);
    if (embedded) return embedded;
  } else if (preference === "external") {
    const external = solanaWallets.find(isExternalWallet);
    if (external) return external;
  }

  if (primaryWallet && isSolana(primaryWallet)) return primaryWallet;

  const compatibleEmbedded = solanaWallets.find(isCompatibleEmbeddedWallet);
  if (compatibleEmbedded) return compatibleEmbedded;
  return solanaWallets[0] ?? null;
}
