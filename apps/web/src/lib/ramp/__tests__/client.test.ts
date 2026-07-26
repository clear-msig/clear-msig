import { beforeEach, describe, expect, it, vi } from "vitest";
import { rampRequestBase } from "@/lib/ramp/client";

describe("ramp client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the app proxy in the browser", () => {
    vi.stubGlobal("window", {});

    expect(rampRequestBase()).toBe("/api/ramp");
  });

  it("uses the service URL on the server", () => {
    vi.stubGlobal("window", undefined);

    expect(rampRequestBase()).toMatch(/^https?:\/\//);
  });
});
