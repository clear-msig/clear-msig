import { describe, expect, it } from "vitest";
import {
  connectedWalletRuntime,
  selectSolanaWallet,
} from "@/lib/wallet/selection";

type TestWallet = {
  id: string;
  solana: boolean;
  connector?: { key?: string; name?: string; overrideKey?: string };
};

const isSolana = (wallet: TestWallet) => wallet.solana;

describe("selectSolanaWallet", () => {
  it("prefers the active Solana wallet over a compatible embedded wallet", () => {
    const embedded = {
      id: "embedded-solana",
      solana: true,
      connector: { key: "turnkey-solana" },
    };
    const solflare = {
      id: "solflare",
      solana: true,
      connector: { key: "solflare" },
    };

    expect(selectSolanaWallet(solflare, [embedded, solflare], isSolana)).toBe(
      solflare,
    );
  });

  it("uses the embedded Solana wallet when the active wallet is not Solana", () => {
    const evm = {
      id: "embedded-evm",
      solana: false,
      connector: { key: "turnkey-evm" },
    };
    const embeddedSolana = {
      id: "embedded-solana",
      solana: true,
      connector: { key: "turnkey-solana" },
    };

    expect(selectSolanaWallet(evm, [evm, embeddedSolana], isSolana)).toBe(
      embeddedSolana,
    );
  });

  it("keeps a Google session on its embedded wallet when extensions are linked", () => {
    const google = {
      id: "embedded-solana",
      solana: true,
      connector: { key: "turnkey-solana" },
    };
    const phantom = {
      id: "phantom",
      solana: true,
      connector: { key: "phantom" },
    };

    expect(
      selectSolanaWallet(google, [google, phantom], isSolana, "embedded"),
    ).toBe(google);
    expect(connectedWalletRuntime(google, [google, phantom])).toBe("embedded");
  });

  it("classifies a Dynamic V3 WaaS Solana wallet as embedded", () => {
    const waas = {
      id: "dynamic-waas-solana",
      solana: true,
      connector: { overrideKey: "dynamicwaas" },
    };
    const phantom = {
      id: "phantom",
      solana: true,
      connector: { key: "phantom" },
    };

    expect(selectSolanaWallet(waas, [waas, phantom], isSolana, "embedded")).toBe(
      waas,
    );
    expect(connectedWalletRuntime(waas, [waas, phantom])).toBe("embedded");
  });

  it("selects the native signer when the authenticated runtime is external", () => {
    const google = {
      id: "embedded-solana",
      solana: true,
      connector: { key: "turnkey-solana" },
    };
    const solflare = {
      id: "solflare",
      solana: true,
      connector: { key: "solflare" },
    };

    expect(
      selectSolanaWallet(google, [google, solflare], isSolana, "external"),
    ).toBe(solflare);
    expect(connectedWalletRuntime(solflare, [google, solflare])).toBe(
      "external",
    );
  });
});
