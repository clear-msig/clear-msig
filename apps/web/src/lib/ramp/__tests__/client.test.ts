import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rampApi, rampRequestBase } from "@/lib/ramp/client";
import { configureRampTokenGetter } from "@/lib/ramp/sessionToken";

describe("ramp client", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    configureRampTokenGetter(() => undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the app proxy in the browser", () => {
    expect(rampRequestBase()).toBe("/api/ramp");
  });

  it("uses the service URL on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(rampRequestBase()).toMatch(/^https?:\/\//);
  });

  it("rejects a connected wallet without a signed-in Dynamic session before sending", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(rampApi.getIntent("public-wallet-address", "intent-id"))
      .rejects.toMatchObject({ status: 401, message: expect.stringContaining("Sign in with Dynamic") });
    await expect(rampApi.resolveBank("0123456789", "001")).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards the current bearer and selected wallet without manufacturing user identity", async () => {
    let token = "first.signed.session";
    configureRampTokenGetter(() => token);
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { intent_id: "intent-id" } }));
    vi.stubGlobal("fetch", fetch);
    await rampApi.getIntent("selected-wallet", "intent-id");
    expect(fetch).toHaveBeenLastCalledWith("/api/ramp/v1/ramp/intents/intent-id", expect.objectContaining({
      headers: { authorization: "Bearer first.signed.session", "x-wallet-address": "selected-wallet" },
    }));
    token = "refreshed.signed.session";
    fetch.mockResolvedValue(Response.json({ success: true, data: {} }));
    await rampApi.initializePayment("selected-wallet", "intent-id");
    const headers = fetch.mock.lastCall?.[1].headers;
    expect(headers.authorization).toBe("Bearer refreshed.signed.session");
    expect(headers).not.toHaveProperty("x-user-id");
    token = "";
    await expect(rampApi.getIntent("selected-wallet", "intent-id")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps bank directory lookup public without attaching session credentials", async () => {
    configureRampTokenGetter(() => "signed.session.token");
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: [] }));
    vi.stubGlobal("fetch", fetch);
    await expect(rampApi.listBanks()).resolves.toEqual([]);
    expect(fetch.mock.lastCall?.[1].headers).not.toHaveProperty("authorization");
  });

  it("preserves idempotency, payload and cancellation while authenticating writes", async () => {
    configureRampTokenGetter(() => "signed.session.token");
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { intent_id: "intent-id" } }));
    vi.stubGlobal("fetch", fetch);
    const body = { intent_type: "onramp", chain_family: "solana", chain_id: "devnet", asset_symbol: "SOL", asset_amount_minor: 0, usd_amount_cents: 100, destination_wallet: "destination" } as const;
    const signal = new AbortController().signal;
    await rampApi.createIntent("selected-wallet", body, "stable-retry-key", signal);
    expect(fetch.mock.lastCall?.[1]).toMatchObject({
      signal, body: JSON.stringify(body), headers: {
        "content-type": "application/json", "idempotency-key": "stable-retry-key",
        authorization: "Bearer signed.session.token", "x-wallet-address": "selected-wallet",
      },
    });
  });

  it("authenticates deposit proof submission even without a selected wallet parameter", async () => {
    configureRampTokenGetter(() => "signed.session.token");
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { accepted: true } }));
    vi.stubGlobal("fetch", fetch);
    await rampApi.confirmChainTransfer({
      intent_id: "intent-id", tx_hash: "chain-proof", chain_family: "solana",
      chain_id: "devnet", event_index: 0, sender_wallet: "source-wallet",
      asset_symbol: "SOL", amount_minor: 1, confirmations: 0, finalized: false,
    });
    expect(fetch.mock.lastCall?.[1].headers.authorization).toBe("Bearer signed.session.token");
  });
});
