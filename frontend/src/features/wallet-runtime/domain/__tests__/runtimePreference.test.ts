import { describe, expect, it } from "vitest";
import {
  EXTERNAL_WALLET_RUNTIME_KEY,
  readAuthenticatedWalletRuntime,
  storeAuthenticatedWalletRuntime,
} from "@/features/wallet-runtime/domain/runtimePreference";

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("authenticated wallet runtime preference", () => {
  it("defaults to the embedded runtime", () => {
    expect(readAuthenticatedWalletRuntime(memoryStorage())).toBe("embedded");
  });

  it("persists external selection and clears it for social sign-in", () => {
    const storage = memoryStorage();

    expect(storeAuthenticatedWalletRuntime(storage, "external")).toBe(true);
    expect(readAuthenticatedWalletRuntime(storage)).toBe("external");
    expect(storeAuthenticatedWalletRuntime(storage, "external")).toBe(false);

    expect(storeAuthenticatedWalletRuntime(storage, "embedded")).toBe(true);
    expect(readAuthenticatedWalletRuntime(storage)).toBe("embedded");
  });

  it("reads the previous external runtime key without migration", () => {
    const storage = memoryStorage({ [EXTERNAL_WALLET_RUNTIME_KEY]: "1" });
    expect(readAuthenticatedWalletRuntime(storage)).toBe("external");
  });
});
