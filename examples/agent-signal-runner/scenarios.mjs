const SUPPORTED_SCENARIOS = ["valid", "blocked", "retry"];

export function scenarioNames() {
  return [...SUPPORTED_SCENARIOS];
}

export function buildScenarioSignal(
  scenario,
  {
    now = Date.now(),
    market = "BTC-PERP",
    side = "long",
    idSuffix = randomSuffix(),
    markPriceUsd = null,
  } = {},
) {
  assertScenario(scenario);

  const base = {
    clientSignalId: safeSignalId(`demo-${scenario}-${now}-${idSuffix}`),
    submittedAt: now,
    venue: "mock_perps",
    market: market.trim().toUpperCase(),
    side,
    orderType: "market",
    confidence: 78,
    expiresInMinutes: 15,
  };

  if (scenario === "blocked") {
    return {
      ...base,
      notionalUsd: "25000",
      leverage: 20,
      thesis:
        "Deliberately unsafe demo signal: oversized, over-leveraged, and missing a stop loss.",
    };
  }

  const exits = exitsFromMarkPrice(markPriceUsd, side);
  return {
    ...base,
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: exits?.stopLossPrice ?? "65000",
    takeProfitPrice: exits?.takeProfitPrice ?? "69000",
    thesis:
      scenario === "retry"
        ? "Valid demo signal submitted twice to prove retry idempotency."
        : "Valid bounded demo signal with defined invalidation.",
  };
}

function exitsFromMarkPrice(markPriceUsd, side) {
  const mark = Number(markPriceUsd);
  if (!Number.isFinite(mark) || mark <= 0) return null;
  const stopMultiplier = side === "short" ? 1.02 : 0.98;
  const targetMultiplier = side === "short" ? 0.97 : 1.03;
  return {
    stopLossPrice: formatPrice(mark * stopMultiplier),
    takeProfitPrice: formatPrice(mark * targetMultiplier),
  };
}

function formatPrice(value) {
  return value.toFixed(value >= 100 ? 2 : 4).replace(/\.?0+$/, "");
}

export function expectedDemoOutcome(scenario) {
  assertScenario(scenario);
  if (scenario === "blocked") {
    return "Expected after import: blocked by hard risk limits.";
  }
  if (scenario === "retry") {
    return "Expected at intake: first request queued, second request marked duplicate.";
  }
  return "Expected after import: needs approval without a session; allowed with a current bounded session.";
}

function assertScenario(scenario) {
  if (!SUPPORTED_SCENARIOS.includes(scenario)) {
    throw new Error(
      `Unknown scenario "${scenario}". Use ${SUPPORTED_SCENARIOS.join(", ")}.`,
    );
  }
}

function safeSignalId(value) {
  return value.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 80);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
