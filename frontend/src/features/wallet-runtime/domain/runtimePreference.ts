export const EXTERNAL_WALLET_RUNTIME_KEY = "clear.wallet-runtime.external.v1";
export const EXTERNAL_WALLET_RUNTIME_EVENT = "clear:wallet-runtime-external";

export type AuthenticatedWalletRuntime = "embedded" | "external";

type RuntimeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readAuthenticatedWalletRuntime(
  storage: RuntimeStorage,
): AuthenticatedWalletRuntime {
  return storage.getItem(EXTERNAL_WALLET_RUNTIME_KEY) === "1"
    ? "external"
    : "embedded";
}

export function storeAuthenticatedWalletRuntime(
  storage: RuntimeStorage,
  runtime: AuthenticatedWalletRuntime,
): boolean {
  const current = readAuthenticatedWalletRuntime(storage);
  if (current === runtime) return false;
  if (runtime === "external") {
    storage.setItem(EXTERNAL_WALLET_RUNTIME_KEY, "1");
  } else {
    storage.removeItem(EXTERNAL_WALLET_RUNTIME_KEY);
  }
  return true;
}
