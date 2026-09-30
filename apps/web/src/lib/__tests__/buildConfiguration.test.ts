import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config";

afterEach(() => vi.unstubAllEnvs());

describe("production build memory configuration", () => {
  it("isolates compilation without skipping validation or adding parallel compilers", () => {
    expect(nextConfig.experimental.webpackBuildWorker).toBe(true);
    expect(nextConfig).not.toHaveProperty("typescript.ignoreBuildErrors", true);
    expect(nextConfig).not.toHaveProperty("eslint.ignoreDuringBuilds", true);
    expect(nextConfig.experimental).not.toHaveProperty("parallelServerCompiles", true);
    expect(nextConfig.experimental).not.toHaveProperty("parallelServerBuildTraces", true);
  });

  it("keeps custom externals and the normal filesystem cache", () => {
    vi.stubEnv("CLEARSIG_BUNDLE_PROFILE", "0");
    const cache = { type: "filesystem" };
    const config = nextConfig.webpack(
      { externals: ["existing-external"], cache },
      { isServer: false },
    );
    expect(config.externals).toEqual(["existing-external", "pino-pretty", "lokijs", "encoding"]);
    expect(config.cache).toBe(cache);
    expect(config.plugins).toBeUndefined();
  });

  it("keeps the client-only bundle profiling plugin available inside workers", () => {
    vi.stubEnv("CLEARSIG_BUNDLE_PROFILE", "1");
    const client = nextConfig.webpack({}, { isServer: false });
    expect(client.cache).toBe(false);
    expect(client.plugins).toHaveLength(1);
    expect(client.plugins?.[0].apply).toBeTypeOf("function");
    expect(nextConfig.webpack({}, { isServer: true }).plugins).toBeUndefined();
    expect(nextConfig.webpack({}, { isServer: false, nextRuntime: "edge" }).plugins).toBeUndefined();
  });
});
