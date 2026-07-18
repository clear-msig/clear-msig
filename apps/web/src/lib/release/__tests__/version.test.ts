import { describe, expect, it } from "vitest";
import {
  getFrontendVersion,
  rpcProviderLabel,
} from "@/lib/release/version";

describe("frontend version contract", () => {
  it("exposes deploy and program metadata for release verification", () => {
    const version = getFrontendVersion();

    expect(version.status).toBe("ok");
    expect(version.service).toBe("clear-msig-frontend");
    expect(version.program.id).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(version.backendUrl).toBeTruthy();
    expect(version.program.network).toBe("solana-devnet");
    expect(version.program).not.toHaveProperty("rpcUrl");
    expect(JSON.stringify(version.program)).not.toContain("/v2/");
  });

  it("reduces credential-bearing RPC endpoints to a provider label", () => {
    const endpoint = "https://solana-devnet.g.alchemy.com/v2/private-key";

    expect(rpcProviderLabel(endpoint)).toBe("alchemy");
    expect(rpcProviderLabel(endpoint)).not.toContain("private-key");
  });
});
