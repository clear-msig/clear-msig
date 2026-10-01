import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewStage } from "./RecoverySweepStages";

const source = "So11111111111111111111111111111111111111112";
const destination = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function render(props: Partial<Parameters<typeof ReviewStage>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ReviewStage, {
      destination,
      dwalletPubkey: source,
      amountDisplay: "0.5 SOL",
      messageBytesLen: 150,
      isSpl: false,
      willCreateAta: false,
      authMode: "wallet",
      setAuthMode() {},
      walletIsMember: true,
      vaultHasPasskey: false,
      onBack() {},
      onContinue() {},
      reduce: true,
      threshold: 2,
      memberCount: 3,
      ...props,
    }),
  );
}

describe("recovery sweep authorization review", () => {
  it("shows full source and destination as visible wrapping text, never hover-only", () => {
    const html = render();
    expect(html).toContain(`>${source}</dd>`);
    expect(html).toContain(`>${destination}</dd>`);
    expect(html).not.toContain(`title="${destination}"`);
    expect(html).not.toContain("truncate");
    expect(html).toContain("break-all");
    expect(html).toContain("2 of 3 members");
  });
  it("shows token mint identity and explains unknown network fee and rent", () => {
    const html = render({ isSpl: true, mint: source, willCreateAta: true });
    expect(html).toContain("Token mint");
    expect(html).toContain("Unavailable in this preview; not zero");
    expect(html).toContain("may also require rent");
    expect(html).toContain("cluster identity not independently verified");
  });
  it("does not invent absent approval authority or token identity", () => {
    const html = render({
      isSpl: true,
      mint: null,
      threshold: null,
      memberCount: null,
    });
    expect(html).toContain("Unavailable — return to amount selection");
    expect(html).not.toContain("2 of 3 members");
    expect(html).not.toContain("1 of 1");
  });
});
