import { describe, expect, it } from "vitest";
import {
  baseChainSendStatus,
  chainSendSubtitle,
} from "../send-support";

describe("chain send support", () => {
  it("treats the live chains as send-ready", () => {
    expect(baseChainSendStatus(0)).toBe("ready");
    expect(baseChainSendStatus(1)).toBe("ready");
    expect(baseChainSendStatus(2)).toBe("ready");
    expect(baseChainSendStatus(3)).toBe("ready");
  });

  it("falls back to coming soon for unknown chain kinds", () => {
    expect(baseChainSendStatus(99)).toBe("coming_soon");
  });

  it("maps labels for picker badges", () => {
    expect(chainSendSubtitle("ready")).toBe("Ready");
    expect(chainSendSubtitle("needs_setup")).toBe("Set up sending");
    expect(chainSendSubtitle("needs_binding")).toBe("Add chain");
    expect(chainSendSubtitle("coming_soon")).toBe("Coming soon");
  });
});
