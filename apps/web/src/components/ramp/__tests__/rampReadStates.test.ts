import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RampBankField } from "../RampBankField";
import { RampChainPicker } from "../RampChainPicker";
import type { ChainBindingResponse } from "@/lib/api/types";

const noop = () => {};
const bank = {
  name: "Fixture Bank",
  code: "999",
  slug: null,
  country: "NG",
  currency: "NGN",
};
const props = {
  banks: [bank],
  loading: false,
  failed: false,
  disabled: false,
  value: "",
  onChange: noop,
  onRetry: noop,
};

describe("ramp read-state controls", () => {
  it("distinguishes a failed read from loading and keeps selection disabled", () => {
    const html = renderToStaticMarkup(
      createElement(RampBankField, { ...props, failed: true }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Banks unavailable");
    expect(html).toContain("Retry bank list");
    expect(html).toMatch(/<select[^>]*disabled/);
    expect(html).not.toContain("Loading banks");
  });
  it("labels an empty completed read honestly", () => {
    const html = renderToStaticMarkup(
      createElement(RampBankField, { ...props, banks: [] }),
    );
    expect(html).toContain("No banks available");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Loading banks");
  });
  it("does not expose retry while a read is in flight", () => {
    const html = renderToStaticMarkup(
      createElement(RampBankField, { ...props, loading: true }),
    );
    expect(html).toContain("Loading banks");
    expect(html).not.toContain("Retry bank list");
  });
  it("keeps unbound networks disabled and identifies the selected network", () => {
    const html = renderToStaticMarkup(
      createElement(RampChainPicker, {
        bindings: [
          {
            chain_kind: 0,
            solana_address: "11111111111111111111111111111111",
          } as ChainBindingResponse,
        ],
        selectedKind: 0,
        disabled: false,
        onPickChain: noop,
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Selected");
    expect(html).toContain("Not bound");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(4);
  });
});
