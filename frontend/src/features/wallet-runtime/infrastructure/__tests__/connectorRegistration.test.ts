import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const waasRuntimeSource = readFileSync(
  new URL("../WaasDynamicProviderTree.tsx", import.meta.url),
  "utf8",
);
const turnkeyRuntimeSource = readFileSync(
  new URL("../TurnkeyDynamicProviderTree.tsx", import.meta.url),
  "utf8",
);
const connectRuntimeSource = readFileSync(
  new URL("../ConnectDynamicProviderTree.tsx", import.meta.url),
  "utf8",
);

describe("Dynamic connector registration", () => {
  it("keeps V3 WaaS isolated from the legacy connector entry", () => {
    expect(waasRuntimeSource).toContain("DynamicWaasSVMConnectors");
    expect(waasRuntimeSource).toContain("@dynamic-labs/waas-svm");
    expect(waasRuntimeSource).not.toContain("TurnkeySolanaWalletConnectors");
  });

  it("keeps legacy Turnkey isolated from the current WaaS entry", () => {
    expect(turnkeyRuntimeSource).toContain("TurnkeySolanaWalletConnectors");
    expect(turnkeyRuntimeSource).toContain(
      "@dynamic-labs/embedded-wallet-solana",
    );
    expect(turnkeyRuntimeSource).not.toContain("DynamicWaasSVMConnectors");
  });

  it("uses Dynamic's complete Solana connector family during login", () => {
    expect(connectRuntimeSource).toContain("SolanaWalletConnectors");
    expect(connectRuntimeSource).not.toContain(
      'import { TurnkeySolanaWalletConnectors }',
    );
  });
});
