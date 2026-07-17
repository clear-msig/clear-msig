import { describe, expect, it } from "vitest";
import {
  EMBEDDED_WALLET_RUNTIME_KEY,
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
  it("defaults to the current WaaS embedded runtime", () => {
    expect(readAuthenticatedWalletRuntime(memoryStorage())).toBe(
      "embedded-waas",
    );
  });

  it("persists external selection and the exact social wallet runtime", () => {
    const storage = memoryStorage();

    expect(storeAuthenticatedWalletRuntime(storage, "external")).toBe(true);
    expect(readAuthenticatedWalletRuntime(storage)).toBe("external");
    expect(storeAuthenticatedWalletRuntime(storage, "external")).toBe(false);

    expect(storeAuthenticatedWalletRuntime(storage, "embedded-turnkey")).toBe(
      true,
    );
    expect(readAuthenticatedWalletRuntime(storage)).toBe("embedded-turnkey");

    expect(storeAuthenticatedWalletRuntime(storage, "embedded-waas")).toBe(
      true,
    );
    expect(readAuthenticatedWalletRuntime(storage)).toBe("embedded-waas");
  });

  it("reads the previous external runtime key without migration", () => {
    const storage = memoryStorage({ [EXTERNAL_WALLET_RUNTIME_KEY]: "1" });
    expect(readAuthenticatedWalletRuntime(storage)).toBe("external");
  });

  it("reads a persisted legacy Turnkey session without loading WaaS", () => {
    const storage = memoryStorage({
      [EMBEDDED_WALLET_RUNTIME_KEY]: "turnkey",
    });
    expect(readAuthenticatedWalletRuntime(storage)).toBe("embedded-turnkey");
  });
});
