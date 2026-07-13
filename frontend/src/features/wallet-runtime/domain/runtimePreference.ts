export const EXTERNAL_WALLET_RUNTIME_KEY = "clear.wallet-runtime.external.v1";
export const EMBEDDED_WALLET_RUNTIME_KEY = "clear.wallet-runtime.embedded.v1";
export const EXTERNAL_WALLET_RUNTIME_EVENT = "clear:wallet-runtime-external";

export type AuthenticatedWalletRuntime =
  | "embedded-waas"
  | "embedded-turnkey"
  | "external";

type RuntimeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readAuthenticatedWalletRuntime(
  storage: RuntimeStorage,
): AuthenticatedWalletRuntime {
  if (storage.getItem(EXTERNAL_WALLET_RUNTIME_KEY) === "1") return "external";
  return storage.getItem(EMBEDDED_WALLET_RUNTIME_KEY) === "turnkey"
    ? "embedded-turnkey"
    : "embedded-waas";
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
    storage.setItem(
      EMBEDDED_WALLET_RUNTIME_KEY,
      runtime === "embedded-turnkey" ? "turnkey" : "waas",
    );
  }
  return true;
}
