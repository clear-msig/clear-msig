import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientSignalId,
  createTradeDecision,
  signTradeDecision,
  submitTradeDecision,
  validateTradeDecision,
} from "./sdk.mjs";

test("builds an evidence-rich ClearSig decision", () => {
  const decision = createTradeDecision({
    clientSignalId: createClientSignalId({
      agentId: "agent-alpha",
      market: "BTC-PERP",
      strategy: "reclaim",
      now: 1_800_000_000_000,
    }),
    submittedAt: 1_800_000_000_000,
    market: "btc-perp",
    side: "long",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "68000",
    takeProfitPrice: "73500",
    thesis: "BTC reclaimed support after funding cooled.",
    technicalSummary: "Support reclaim with stronger close.",
    fundamentalSummary: "No adverse catalyst supplied.",
    newsSummary: "Macro calendar is quiet for this decision window.",
    riskPlan: "Small size, stop below support.",
    exitPlan: "Exit at target or failed support.",
    invalidation: "Invalid below 68000.",
  });

  assert.equal(decision.market, "BTC-PERP");
  assert.equal(decision.technicalSummary, "Support reclaim with stronger close.");
  assert.deepEqual(validateTradeDecision(decision), []);
});

test("requires evidence fields creators should provide", () => {
  const errors = validateTradeDecision({
    clientSignalId: "bad id with spaces",
    submittedAt: 1_800_000_000_000,
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    notionalUsd: "250",
    leverage: 1,
  });

  assert(errors.includes("clientSignalId must be 80 safe characters or fewer."));
  assert(errors.includes("stopLossPrice is required for creator-owned decisions."));
  assert(errors.includes("thesis is required."));
  assert(errors.includes("riskPlan is required."));
  assert(errors.includes("invalidation is required."));
});

test("signs trade decisions with the submit-only signal key", () => {
  const decision = createTradeDecision({
    clientSignalId: "decision-1",
    submittedAt: 1_800_000_000_000,
    market: "BTC-PERP",
    side: "long",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "68000",
    thesis: "BTC reclaimed support.",
    riskPlan: "Small size with stop.",
    invalidation: "Support fails.",
  });

  assert.match(
    signTradeDecision({ decision, signalKey: "submit-only-key" }),
    /^[a-f0-9]{64}$/,
  );
});

test("submits with the submit-only signal key and signed decision", async () => {
  const requests = [];
  const response = await submitTradeDecision({
    endpoint: "http://localhost:3000/api/agent-signals/vault/agent-alpha",
    signalKey: "submit-only-key",
    decision: createTradeDecision({
      clientSignalId: "decision-1",
      submittedAt: 1_800_000_000_000,
      market: "BTC-PERP",
      side: "long",
      notionalUsd: "250",
      leverage: 1,
      stopLossPrice: "68000",
      takeProfitPrice: "73500",
      thesis: "BTC reclaimed support.",
      riskPlan: "Small size with stop.",
      invalidation: "Support fails.",
    }),
    fetchImpl: async (endpoint, request) => {
      requests.push({ endpoint: String(endpoint), request });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          id: "queued-1",
          duplicate: false,
          status: "queued_for_clearsig_risk_check",
        }),
      };
    },
  });

  assert.equal(response.id, "queued-1");
  assert.equal(requests[0].request.headers["x-clearsig-signal-key"], "submit-only-key");
  assert.match(requests[0].request.headers["x-clearsig-signal-signature"], /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(requests[0].request.body).signal.clientSignalId, "decision-1");
  assert.equal(JSON.parse(requests[0].request.body).signatureScheme, "hmac_sha256_v1");
});
