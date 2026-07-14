import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("BTC and Solana send module boundaries", () => {
  const btcRoute = source("src/features/send/routes/BtcSendPage.tsx");
  const btcScreen = source(
    "src/features/send/ui/bitcoin/BtcSendScreen.tsx",
  );
  const solanaRoute = source("src/features/send/routes/SolanaSendPage.tsx");

  it("keeps BTC rendering in focused UI modules", () => {
    expect(btcRoute).toContain("/bitcoin/BtcSendScreen");
    expect(btcRoute).toContain("/bitcoin/bitcoinPreview");
    expect(btcScreen).toContain("/bitcoin/BtcSetupStates");
    expect(btcScreen).toContain("/bitcoin/BtcComposeForm");
    expect(btcScreen).toContain("/bitcoin/BtcSendResults");
    expect(btcRoute).not.toContain("function ComposeForm(");
  });

  it("keeps Solana composition and RPC polling outside the route", () => {
    expect(solanaRoute).toContain("/solana/SolanaComposeStage");
    expect(solanaRoute).toContain("/domain/solanaSendProgress");
    expect(solanaRoute).toContain("/infrastructure/solanaProposalStatus");
    expect(solanaRoute).not.toContain("function ComposeStage(");
    expect(solanaRoute).not.toContain("async function waitForProposalStatus(");
  });

  it("keeps render-only modules away from backend and RPC clients", () => {
    const uiFiles = [
      "src/features/send/ui/bitcoin/BtcSetupStates.tsx",
      "src/features/send/ui/bitcoin/BtcComposeForm.tsx",
      "src/features/send/ui/bitcoin/BtcSendResults.tsx",
      "src/features/send/ui/bitcoin/BtcSendScreen.tsx",
      "src/features/send/ui/solana/SolanaComposeStage.tsx",
    ];
    for (const path of uiFiles) {
      const uiSource = source(path);
      expect(uiSource).not.toContain("backendApi");
      expect(uiSource).not.toContain("@solana/web3.js");
    }
  });
});
