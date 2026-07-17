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

function makeFailingLocalStorageStub() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("local storage unavailable");
    },
    clear: vi.fn(),
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

function stubFailingBrowserStorage() {
  vi.stubGlobal("window", {
    localStorage: makeFailingLocalStorageStub(),
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

  it("does not register the server inbox when the local setting cannot be saved", async () => {
    stubFailingBrowserStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      setAgentAutomaticTrading("vault", "agent-alpha", true),
    ).rejects.toThrow("Trader connection not found.");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
