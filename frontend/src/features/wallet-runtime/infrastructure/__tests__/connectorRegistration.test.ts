import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const embeddedRuntimeSource = readFileSync(
  new URL("../EmbeddedDynamicProviderTree.tsx", import.meta.url),
  "utf8",
);
const connectRuntimeSource = readFileSync(
  new URL("../ConnectDynamicProviderTree.tsx", import.meta.url),
  "utf8",
);

describe("Dynamic connector registration", () => {
  it("keeps both V2 Turnkey and V3 WaaS available after social login", () => {
    expect(embeddedRuntimeSource).toContain("TurnkeySolanaWalletConnectors");
    expect(embeddedRuntimeSource).toContain("DynamicWaasSVMConnectors");
    expect(embeddedRuntimeSource).toContain("@dynamic-labs/waas-svm");
  });

  it("uses Dynamic's complete Solana connector family during login", () => {
    expect(connectRuntimeSource).toContain("SolanaWalletConnectors");
    expect(connectRuntimeSource).not.toContain(
      'import { TurnkeySolanaWalletConnectors }',
    );
  });
});
