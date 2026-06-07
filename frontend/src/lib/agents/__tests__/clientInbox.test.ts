import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentConnectionKit } from "@/lib/agents";
import { setAgentAutomaticTrading } from "@/lib/agents/clientInbox";

function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    clear: () => store.clear(),
  };
}

function stubBrowserStorage() {
  vi.stubGlobal("window", {
    localStorage: makeLocalStorageStub(),
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent inbox client", () => {
  it("turns automatic trading on after registering the signal inbox", async () => {
    stubBrowserStorage();
    const kit = getAgentConnectionKit("vault", "agent-alpha");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, storage: "memory" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const updated = await setAgentAutomaticTrading("vault", "agent-alpha", true);

    expect(updated.autoImportSessionSignals).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-signals/vault/agent-alpha",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          signalKey: kit.signalKey,
          managementKey: kit.managementKey,
          autoImportSessionSignals: true,
        }),
      }),
    );
  });

  it("leaves the local setting off when registration fails", async () => {
    stubBrowserStorage();
    getAgentConnectionKit("vault", "agent-alpha");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Forbidden." }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      setAgentAutomaticTrading("vault", "agent-alpha", true),
    ).rejects.toThrow("Forbidden.");
    expect(
      getAgentConnectionKit("vault", "agent-alpha").autoImportSessionSignals,
    ).toBe(false);
  });
});
