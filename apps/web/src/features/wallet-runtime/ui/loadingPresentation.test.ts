import { describe, expect, it } from "vitest";
import { isPublicLoadingPresentation } from "./loadingPresentation";

describe("loading presentation route boundary", () => {
  it.each(["/", "/connect", "/choose", "/personal", "/pro", "/agent", "/secure", "/p2pdefi", "/payments", "/privacy", "/security", "/changelog", "/agents", "/agents/example/vault-one", "/security/", "/agents/Family%20Wallet%23abc123/steady", "/agents/%E5%AE%B6%E5%BA%AD/agent-1"])("uses public chrome for %s", (path) => {
    expect(isPublicLoadingPresentation(path)).toBe(true);
  });
  it.each([null, "", "/app", "/app/wallet", "/app/secure", "/app/settings", "/security-settings", "/secure/vault", "/agents/example", "/agents/example/vault/settings", "/agents/../app", "/agents/a%2Fb/c", "//security", "/unknown", "/connect?next=/app", "/agents/%2e%2e/agent", "/agents/a%5Cb/c", "/agents/%00/c", "/agents/%ZZ/c", "/agents/a/c?next=/app", "/agents/a/c#fragment"])("keeps unknown/protected path %s in app presentation", (path) => {
    expect(isPublicLoadingPresentation(path)).toBe(false);
  });
});
