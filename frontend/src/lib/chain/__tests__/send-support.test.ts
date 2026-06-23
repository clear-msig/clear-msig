import { describe, expect, it } from "vitest";
import {
  baseChainSendStatus,
  chainSendActionLabel,
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
    expect(chainSendSubtitle("needs_setup")).toBe("Turn on");
    expect(chainSendSubtitle("needs_binding")).toBe("Turn on");
    expect(chainSendSubtitle("coming_soon")).toBe("Coming soon");
  });

  it("maps action labels for asset rows", () => {
    expect(chainSendActionLabel("ready")).toBe("Send");
    expect(chainSendActionLabel("needs_setup")).toBe("Turn on");
    expect(chainSendActionLabel("needs_binding")).toBe("Turn on");
    expect(chainSendActionLabel("coming_soon")).toBe("Soon");
  });
});
