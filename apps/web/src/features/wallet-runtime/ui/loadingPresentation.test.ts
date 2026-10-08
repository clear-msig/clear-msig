import { describe, expect, it } from "vitest";
import { isPublicLoadingPresentation } from "./loadingPresentation";

describe("loading presentation route boundary", () => {
  it.each(["/", "/connect", "/choose", "/personal", "/pro", "/agent", "/secure", "/p2pdefi", "/payments", "/privacy", "/security", "/changelog", "/agents", "/agents/example/vault-one", "/security/"])("uses public chrome for %s", (path) => {
    expect(isPublicLoadingPresentation(path)).toBe(true);
  });
  it.each([null, "", "/app", "/app/wallet", "/app/secure", "/app/settings", "/security-settings", "/secure/vault", "/agents/example", "/agents/example/vault/settings", "/agents/../app", "/agents/a%2Fb/c", "//security", "/unknown", "/connect?next=/app"])("keeps unknown/protected path %s in app presentation", (path) => {
    expect(isPublicLoadingPresentation(path)).toBe(false);
  });
});
