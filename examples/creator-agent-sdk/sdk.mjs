const DEFAULT_TIMEOUT_MS = 10_000;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function createClientSignalId({
  agentId = "agent",
  market = "market",
  strategy = "strategy",
  now = Date.now(),
} = {}) {
  return `${safePart(agentId)}:${safePart(strategy)}:${safePart(market)}:${now}`.slice(0, 80);
}

export function createTradeDecision({
  clientSignalId,
  submittedAt = Date.now(),
  venue = "mock_perps",
  market,
  side,
  orderType = "market",
  notionalUsd,
  leverage,
  entryPrice = null,
  stopLossPrice,
  takeProfitPrice,
  confidence = 70,
  expiresInMinutes = 15,
  thesis,
  technicalSummary,
  fundamentalSummary,
  newsSummary,
  riskPlan,
  exitPlan,
  invalidation,
}) {
  const decision = {
    clientSignalId,
    submittedAt,
    venue,
    market: typeof market === "string" ? market.trim().toUpperCase() : market,
    side,
    orderType,
    notionalUsd: String(notionalUsd ?? ""),
    leverage,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    confidence,
    expiresInMinutes,
    thesis,
    technicalSummary,
    fundamentalSummary,
    newsSummary,
    riskPlan,
    exitPlan,
    invalidation,
  };
  return stripEmpty(decision);
}

export function validateTradeDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return ["Decision must be a JSON object."];
  }
  if (!decision.clientSignalId) errors.push("clientSignalId is required.");
  if (decision.clientSignalId && !SAFE_ID.test(decision.clientSignalId)) {
    errors.push("clientSignalId must be 80 safe characters or fewer.");
  }
  if (!Number.isFinite(Number(decision.submittedAt)) || Number(decision.submittedAt) <= 0) {
    errors.push("submittedAt must be a Unix millisecond timestamp.");
  }
  if (!["mock_perps", "hyperliquid_testnet", "bulktrade_mock"].includes(decision.venue)) {
    errors.push("venue is not supported by ClearSig.");
  }
  if (!stringValue(decision.market)) errors.push("market is required.");
  if (!["long", "short"].includes(decision.side)) errors.push("side must be long or short.");
  if (!["market", "limit"].includes(decision.orderType ?? "market")) {
    errors.push("orderType must be market or limit.");
  }
  if (!positive(decision.notionalUsd)) errors.push("notionalUsd must be greater than zero.");
  if (!positive(decision.leverage)) errors.push("leverage must be greater than zero.");
  if (!stringValue(decision.stopLossPrice)) {
    errors.push("stopLossPrice is required for creator-owned decisions.");
  }
  if (!stringValue(decision.thesis)) errors.push("thesis is required.");
  if (!stringValue(decision.riskPlan)) errors.push("riskPlan is required.");
  if (!stringValue(decision.invalidation)) errors.push("invalidation is required.");
  return errors;
}

export async function submitTradeDecision({
  endpoint,
  signalKey,
  decision,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  validateEndpoint(endpoint);
  if (!signalKey) throw new Error("signalKey is required.");
  const errors = validateTradeDecision(decision);
  if (errors.length > 0) {
    throw new Error(`Decision failed validation: ${errors.join(" ")}`);
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clearsig-signal-key": signalKey,
    },
    body: JSON.stringify({ signal: decision }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const details = Array.isArray(body?.details) ? ` ${body.details.join(" ")}` : "";
    throw new Error(
      `ClearSig rejected the decision (${response.status}): ${body?.error ?? response.statusText}.${details}`,
    );
  }
  return body;
}

function validateEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("endpoint must be a valid ClearSig URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("endpoint must use HTTP or HTTPS.");
  }
  if (!parsed.pathname.includes("/api/agent-signals/")) {
    throw new Error("endpoint must point to /api/agent-signals/<wallet>/<agent>.");
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function stripEmpty(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== "" && value != null),
  );
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function safePart(value) {
  return String(value).replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 24);
}
