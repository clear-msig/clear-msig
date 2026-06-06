import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarioSignal } from "./scenarios.mjs";
import { fetchMarketDataSnapshot, parseArgs, submitSignal } from "./run.mjs";

test("builds a valid bounded signal with fresh retry metadata", () => {
  const signal = buildScenarioSignal("valid", {
    now: 1_780_000_000_000,
    idSuffix: "fixed",
  });

  assert.equal(signal.clientSignalId, "demo-valid-1780000000000-fixed");
  assert.equal(signal.submittedAt, 1_780_000_000_000);
  assert.equal(signal.notionalUsd, "250");
  assert.equal(signal.leverage, 1);
  assert.equal(signal.stopLossPrice, "65000");
});

test("builds a signal that default ClearSig risk limits block", () => {
  const signal = buildScenarioSignal("blocked", {
    now: 1_780_000_000_000,
    idSuffix: "fixed",
  });

  assert.equal(signal.notionalUsd, "25000");
  assert.equal(signal.leverage, 20);
  assert.equal(signal.stopLossPrice, undefined);
});

test("parses environment configuration without printing or persisting secrets", () => {
  const previousEndpoint = process.env.CLEARSIG_SIGNAL_ENDPOINT;
  const previousKey = process.env.CLEARSIG_SIGNAL_KEY;
  process.env.CLEARSIG_SIGNAL_ENDPOINT =
    "http://localhost:3000/api/agent-signals/vault/agent";
  process.env.CLEARSIG_SIGNAL_KEY = "cs_sig_test";

  try {
    const options = parseArgs(["--scenario", "retry", "--side", "short"]);
    assert.equal(options.scenario, "retry");
    assert.equal(options.side, "short");
    assert.equal(options.signalKey, "cs_sig_test");
  } finally {
    restoreEnv("CLEARSIG_SIGNAL_ENDPOINT", previousEndpoint);
    restoreEnv("CLEARSIG_SIGNAL_KEY", previousKey);
  }
});

test("submits only the signal key and structured signal payload", async () => {
  let request;
  const response = await submitSignal({
    endpoint: "http://localhost:3000/api/agent-signals/vault/agent",
    signalKey: "cs_sig_test",
    signal: buildScenarioSignal("valid"),
    fetchImpl: async (endpoint, init) => {
      request = { endpoint, init };
      return new Response(
        JSON.stringify({
          ok: true,
          id: "inbox-1",
          duplicate: false,
          status: "queued_for_clearsig_risk_check",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  assert.equal(request.endpoint, "http://localhost:3000/api/agent-signals/vault/agent");
  assert.equal(request.init.headers["x-clearsig-signal-key"], "cs_sig_test");
  assert.equal("x-clearsig-management-key" in request.init.headers, false);
  assert.equal(JSON.parse(request.init.body).signal.venue, "mock_perps");
  assert.equal(response.id, "inbox-1");
});

test("reads a provider snapshot without sending agent credentials", async () => {
  let request;
  const snapshot = await fetchMarketDataSnapshot(
    "http://localhost:3000/api/agent-market-data/mock",
    "BTC-PERP",
    async (endpoint, init) => {
      request = { endpoint: String(endpoint), init };
      return new Response(
        JSON.stringify({
          ok: true,
          snapshot: {
            provider: "mock",
            source: "mock",
            market: "BTC-PERP",
            markPriceUsd: "67500",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.equal(
    request.endpoint,
    "http://localhost:3000/api/agent-market-data/mock?market=BTC-PERP",
  );
  assert.deepEqual(request.init.headers, { accept: "application/json" });
  assert.equal(snapshot.markPriceUsd, "67500");
});

function restoreEnv(name, value) {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
