#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  buildScenarioSignal,
  expectedDemoOutcome,
  scenarioNames,
} from "./scenarios.mjs";

const DEFAULT_TIMEOUT_MS = 10_000;
const SIGNATURE_SCHEME = "hmac_sha256_v1";

export function parseArgs(argv) {
  const options = {
    scenario: "valid",
    endpoint: process.env.CLEARSIG_SIGNAL_ENDPOINT ?? "",
    signalKey: process.env.CLEARSIG_SIGNAL_KEY ?? "",
    marketDataUrl: process.env.CLEARSIG_MARKET_DATA_URL ?? "",
    market: "BTC-PERP",
    side: "long",
    dryRun: false,
    signed: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--unsigned") {
      options.signed = false;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--scenario") {
      options.scenario = requiredValue(argv, ++index, argument);
      continue;
    }
    if (argument === "--endpoint") {
      options.endpoint = requiredValue(argv, ++index, argument);
      continue;
    }
    if (argument === "--signal-key") {
      options.signalKey = requiredValue(argv, ++index, argument);
      continue;
    }
    if (argument === "--market") {
      options.market = requiredValue(argv, ++index, argument);
      continue;
    }
    if (argument === "--market-data-url") {
      options.marketDataUrl = requiredValue(argv, ++index, argument);
      continue;
    }
    if (argument === "--side") {
      options.side = requiredValue(argv, ++index, argument);
      continue;
    }
    throw new Error(`Unknown argument "${argument}". Use --help for usage.`);
  }

  validateOptions(options);
  return options;
}

export async function submitSignal({
  endpoint,
  signalKey,
  signal,
  signed = true,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const signature = signed ? signSignal({ signal, signalKey }) : null;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clearsig-signal-key": signalKey,
      ...(signature ? { "x-clearsig-signal-signature": signature } : {}),
    },
    body: JSON.stringify(
      signature
        ? { signal, signature, signatureScheme: SIGNATURE_SCHEME }
        : { signal },
    ),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readJson(response);

  if (!response.ok) {
    const detail = Array.isArray(body?.details) ? ` ${body.details.join(" ")}` : "";
    throw new Error(
      `ClearSig rejected the signal (${response.status}): ${body?.error ?? response.statusText}.${detail}`,
    );
  }

  return body;
}

export async function run(options, io = console) {
  const marketData = options.marketDataUrl
    ? await fetchMarketDataSnapshot(options.marketDataUrl, options.market)
    : null;
  const signal = buildScenarioSignal(options.scenario, {
    market: options.market,
    side: options.side,
    markPriceUsd: marketData?.markPriceUsd ?? null,
  });

  io.log(`Scenario: ${options.scenario}`);
  io.log(expectedDemoOutcome(options.scenario));
  if (marketData) {
    io.log(
      `Market data: ${marketData.market} mark ${marketData.markPriceUsd} from ${marketData.provider} (${marketData.source})`,
    );
  }
  io.log(JSON.stringify({ signal }, null, 2));

  if (options.dryRun) {
    io.log("Dry run complete. No signal was sent.");
    return { signal, responses: [] };
  }

  const first = await submitSignal({
    endpoint: options.endpoint,
    signalKey: options.signalKey,
    signal,
    signed: options.signed,
  });
  io.log(formatResponse("First submission", first));

  if (options.scenario !== "retry") {
    return { signal, responses: [first] };
  }

  const second = await submitSignal({
    endpoint: options.endpoint,
    signalKey: options.signalKey,
    signal,
    signed: options.signed,
  });
  io.log(formatResponse("Retry submission", second));
  if (first.duplicate !== false || second.duplicate !== true || first.id !== second.id) {
    throw new Error("Retry idempotency check failed.");
  }
  io.log("Retry idempotency verified.");
  return { signal, responses: [first, second] };
}

export function usage() {
  return `ClearSig agent signal demo runner

Usage:
  CLEARSIG_SIGNAL_ENDPOINT="http://localhost:3000/api/agent-signals/<wallet>/<agent>" \\
  CLEARSIG_SIGNAL_KEY="<signal-key>" \\
  node examples/agent-signal-runner/run.mjs --scenario valid

Options:
  --scenario <name>    ${scenarioNames().join(" | ")} (default: valid)
  --endpoint <url>     Signal endpoint; prefer CLEARSIG_SIGNAL_ENDPOINT
  --signal-key <key>   Submit-only key; prefer CLEARSIG_SIGNAL_KEY
  --market-data-url    Optional read-only provider URL; prefer CLEARSIG_MARKET_DATA_URL
  --market <market>    Market for the signal (default: BTC-PERP)
  --side <side>        long | short (default: long)
  --dry-run            Print a fresh payload without sending it
  --unsigned           Submit with signal key only, for compatibility testing
  --help, -h           Show this help
`;
}

function validateOptions(options) {
  if (!scenarioNames().includes(options.scenario)) {
    throw new Error(
      `Unknown scenario "${options.scenario}". Use ${scenarioNames().join(", ")}.`,
    );
  }
  if (!["long", "short"].includes(options.side)) {
    throw new Error('Side must be "long" or "short".');
  }
  if (!options.market.trim()) {
    throw new Error("Market must not be empty.");
  }
  if (options.help) return;
  if (!options.endpoint) {
    throw new Error(
      "Missing signal endpoint. Set CLEARSIG_SIGNAL_ENDPOINT or use --endpoint.",
    );
  }
  validateEndpoint(options.endpoint);
  if (options.marketDataUrl) {
    validateHttpUrl(options.marketDataUrl, "Market-data URL");
  }
  if (!options.dryRun && !options.signalKey) {
    throw new Error(
      "Missing signal key. Set CLEARSIG_SIGNAL_KEY or use --signal-key.",
    );
  }
}

function validateEndpoint(endpoint) {
  const parsed = validateHttpUrl(endpoint, "Signal endpoint");
  if (!parsed.pathname.includes("/api/agent-signals/")) {
    throw new Error("Signal endpoint must be a ClearSig agent-signals API URL.");
  }
}

function validateHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return parsed;
}

export function signSignal({ signal, signalKey }) {
  if (!signalKey) throw new Error("Signal key is required for signed submissions.");
  return createHmac("sha256", signalKey)
    .update(canonicalSignal(signal))
    .digest("hex");
}

export function canonicalSignal(signal) {
  return JSON.stringify(stableValue(signal));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

export async function fetchMarketDataSnapshot(url, market, fetchImpl = fetch) {
  const endpoint = new URL(url);
  endpoint.searchParams.set("market", market);
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const body = await readJson(response);
  if (!response.ok || !body?.snapshot) {
    throw new Error(
      `Market data failed (${response.status}): ${body?.error ?? response.statusText}.`,
    );
  }
  const mark = Number(body.snapshot.markPriceUsd);
  if (!Number.isFinite(mark) || mark <= 0) {
    throw new Error("Market data returned an invalid mark price.");
  }
  return body.snapshot;
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires a value.`);
  }
  return value;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatResponse(label, response) {
  return `${label}: ${response.status} (id ${response.id}, duplicate ${String(response.duplicate)})`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    await run(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
