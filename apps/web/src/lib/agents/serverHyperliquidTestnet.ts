import { createHash } from "crypto";
import type { AgentServerExecutionRequest } from "@/lib/agents/serverExecutionAdapters";
import type { HyperliquidTestnetExecutorConfig } from "@/lib/agents/hyperliquidTestnetConfig";
import {
  type HyperliquidVenueSettlementEvidence,
  verifyHyperliquidTestnetSettlementEvidence,
} from "@/lib/agents/hyperliquidSettlementEvidence";

const HYPERLIQUID_TESTNET_INFO_URL = "https://api.hyperliquid-testnet.xyz/info";
const REQUEST_TIMEOUT_MS = 6_000;

export interface HyperliquidTestnetAccountProbe {
  state: "missing_address" | "unavailable" | "empty" | "funded";
  accountAddress: string | null;
  accountValueUsd: string | null;
  withdrawableUsd: string | null;
  openPositions: number;
  message: string;
}

export interface HyperliquidTestnetPositionSnapshot {
  market: string;
  side: "long" | "short";
  size: string;
  entryPriceUsd: string | null;
  positionValueUsd: string | null;
  unrealizedPnlUsd: string | null;
  returnOnEquityPct: string | null;
  liquidationPriceUsd: string | null;
}

export interface HyperliquidTestnetAccountSnapshot {
  state: HyperliquidTestnetAccountProbe["state"];
  accountAddress: string | null;
  accountValueUsd: string | null;
  withdrawableUsd: string | null;
  totalPositionValueUsd: string | null;
  unrealizedPnlUsd: string | null;
  positions: HyperliquidTestnetPositionSnapshot[];
  observedAt: number;
  message: string;
}

export interface HyperliquidTestnetExecutorProbe {
  state: "not_configured" | "unavailable" | "ready";
  accountAddress: string | null;
  agentWalletAddress: string | null;
  message: string;
}

export interface HyperliquidTestnetOrderArtifact {
  exchange: "hyperliquid_testnet";
  orderId: string;
  status: "accepted" | "resting" | "filled";
  market: string;
  side: "long" | "short";
  filledSize?: string;
  averagePriceUsd?: string;
  submittedAt: number;
}

export interface HyperliquidTestnetSettlementClaim {
  exchange: "hyperliquid_testnet";
  network: "testnet";
  serverRequestId: string;
  openingOrderId: string;
  closingOrderId: string;
  market: string;
  side: "long" | "short";
  closedSize: string;
  reservedNotionalUsd: string;
  realizedPnlUsd: string;
  fillHashes: string[];
  settledAt: number;
}

export interface HyperliquidTestnetSettlementArtifact
  extends HyperliquidTestnetSettlementClaim {
  venueEvidence: HyperliquidVenueSettlementEvidence;
}

export interface HyperliquidTestnetKillSwitchArtifact {
  exchange: "hyperliquid_testnet";
  status: "accepted" | "cancelled" | "no_open_orders";
  cancelledAt: number;
  message: string;
}

export interface HyperliquidTestnetExecutorRequest {
  schemaVersion: 1;
  network: "testnet";
  idempotencyKey: string;
  accountAddress: string;
  agentWalletAddress: string;
  intent: AgentServerExecutionRequest;
  controls: {
    maxSlippageBps: number;
  };
}

export interface HyperliquidTestnetKillSwitchRequest {
  schemaVersion: 1;
  network: "testnet";
  idempotencyKey: string;
  accountAddress: string;
  agentWalletAddress: string;
  walletName: string;
  reason: string;
}

export interface HyperliquidTestnetSettlementRequest {
  schemaVersion: 1;
  network: "testnet";
  idempotencyKey: string;
  accountAddress: string;
  agentWalletAddress: string;
  serverRequestId: string;
  intent: AgentServerExecutionRequest;
  openingArtifact: HyperliquidTestnetOrderArtifact;
  controls: { maxSlippageBps: number };
}

export async function probeHyperliquidTestnetAccount({
  accountAddress,
  fetchImpl = fetch,
}: {
  accountAddress: string | null | undefined;
  fetchImpl?: typeof fetch;
}): Promise<HyperliquidTestnetAccountProbe> {
  const snapshot = await fetchHyperliquidTestnetAccountSnapshot({
    accountAddress,
    fetchImpl,
  });
  return hyperliquidProbeFromSnapshot(snapshot);
}

export async function fetchHyperliquidTestnetAccountSnapshot({
  accountAddress,
  fetchImpl = fetch,
  now = Date.now(),
}: {
  accountAddress: string | null | undefined;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<HyperliquidTestnetAccountSnapshot> {
  if (!accountAddress || !isEvmAddress(accountAddress.trim())) {
    return {
      state: "missing_address",
      accountAddress: null,
      accountValueUsd: null,
      withdrawableUsd: null,
      totalPositionValueUsd: null,
      unrealizedPnlUsd: null,
      positions: [],
      observedAt: now,
      message: "Add a valid Hyperliquid testnet account address to check funding.",
    };
  }
  const normalizedAddress = accountAddress.trim().toLowerCase();

  try {
    const response = await fetchImpl(HYPERLIQUID_TESTNET_INFO_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "clearinghouseState",
        user: normalizedAddress,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const marginSummary = objectValue(body.marginSummary);
    const accountValueUsd = decimalString(marginSummary?.accountValue);
    const withdrawableUsd = decimalString(body.withdrawable);
    const positions = parseHyperliquidPositions(body.assetPositions);
    const totalPositionValueUsd =
      decimalString(marginSummary?.totalNtlPos) ??
      sumNullableMoney(positions.map((position) => position.positionValueUsd));
    const unrealizedPnlUsd = sumNullableMoney(
      positions.map((position) => position.unrealizedPnlUsd),
    );
    const funded =
      Number(accountValueUsd ?? 0) > 0 ||
      Number(withdrawableUsd ?? 0) > 0 ||
      positions.length > 0;
    return {
      state: funded ? "funded" : "empty",
      accountAddress: normalizedAddress,
      accountValueUsd,
      withdrawableUsd,
      totalPositionValueUsd,
      unrealizedPnlUsd,
      positions,
      observedAt: now,
      message: funded
        ? "Hyperliquid testnet account is reachable and funded."
        : "Hyperliquid testnet account is reachable but has no trading collateral.",
    };
  } catch {
    return {
      state: "unavailable",
      accountAddress: normalizedAddress,
      accountValueUsd: null,
      withdrawableUsd: null,
      totalPositionValueUsd: null,
      unrealizedPnlUsd: null,
      positions: [],
      observedAt: now,
      message: "Could not reach Hyperliquid testnet account state.",
    };
  }
}

export function hyperliquidProbeFromSnapshot(
  snapshot: HyperliquidTestnetAccountSnapshot,
): HyperliquidTestnetAccountProbe {
  return {
    state: snapshot.state,
    accountAddress: snapshot.accountAddress,
    accountValueUsd: snapshot.accountValueUsd,
    withdrawableUsd: snapshot.withdrawableUsd,
    openPositions: snapshot.positions.length,
    message: snapshot.message,
  };
}

export async function probeHyperliquidTestnetExecutor({
  config,
  fetchImpl = fetch,
}: {
  config: HyperliquidTestnetExecutorConfig | null;
  fetchImpl?: typeof fetch;
}): Promise<HyperliquidTestnetExecutorProbe> {
  if (!config) {
    return {
      state: "not_configured",
      accountAddress: null,
      agentWalletAddress: null,
      message: "The protected Hyperliquid practice connection has not been set up.",
    };
  }
  try {
    const response = await fetchImpl(`${config.executorUrl}/health`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const accountAddress = stringValue(body.accountAddress).toLowerCase();
    const agentWalletAddress = stringValue(body.agentWalletAddress).toLowerCase();
    if (
      body.ok !== true ||
      body.network !== "testnet" ||
      accountAddress !== config.accountAddress ||
      agentWalletAddress !== config.agentWalletAddress
    ) {
      throw new Error("Protected connection returned an unexpected account or API wallet.");
    }
    return {
      state: "ready",
      accountAddress,
      agentWalletAddress,
      message: "The protected Hyperliquid practice connection is ready with the approved API wallet.",
    };
  } catch {
    return {
      state: "unavailable",
      accountAddress: config.accountAddress,
      agentWalletAddress: config.agentWalletAddress,
      message: "The protected Hyperliquid practice connection or API wallet could not be verified.",
    };
  }
}

export function buildHyperliquidTestnetExecutorRequest(
  request: AgentServerExecutionRequest,
  config: HyperliquidTestnetExecutorConfig,
): HyperliquidTestnetExecutorRequest {
  return {
    schemaVersion: 1,
    network: "testnet",
    idempotencyKey: createHash("sha256")
      .update(
        `${request.walletName}:${request.agentId}:${request.proposalId}:${request.venue}`,
      )
      .digest("hex"),
    accountAddress: config.accountAddress,
    agentWalletAddress: config.agentWalletAddress,
    intent: request,
    controls: {
      maxSlippageBps: 50,
    },
  };
}

export function buildHyperliquidTestnetKillSwitchRequest({
  walletName,
  reason,
  config,
}: {
  walletName: string;
  reason: string;
  config: HyperliquidTestnetExecutorConfig;
}): HyperliquidTestnetKillSwitchRequest {
  return {
    schemaVersion: 1,
    network: "testnet",
    idempotencyKey: createHash("sha256")
      .update(`${walletName}:hyperliquid_testnet:kill-switch`)
      .digest("hex"),
    accountAddress: config.accountAddress,
    agentWalletAddress: config.agentWalletAddress,
    walletName,
    reason: reason.trim() || "ClearSig agent trading kill switch",
  };
}

export function buildHyperliquidTestnetSettlementRequest({
  serverRequestId,
  request,
  openingArtifact,
  config,
}: {
  serverRequestId: string;
  request: AgentServerExecutionRequest;
  openingArtifact: HyperliquidTestnetOrderArtifact;
  config: HyperliquidTestnetExecutorConfig;
}): HyperliquidTestnetSettlementRequest {
  if (!openingArtifact.filledSize) {
    throw new Error("Opening venue artifact has no verified filled size.");
  }
  return {
    schemaVersion: 1,
    network: "testnet",
    idempotencyKey: createHash("sha256")
      .update(`${serverRequestId}:${openingArtifact.orderId}:settlement:v1`)
      .digest("hex"),
    accountAddress: config.accountAddress,
    agentWalletAddress: config.agentWalletAddress,
    serverRequestId,
    intent: request,
    openingArtifact,
    controls: { maxSlippageBps: 50 },
  };
}

export async function submitHyperliquidTestnetOrder({
  request,
  config,
  fetchImpl = fetch,
}: {
  request: AgentServerExecutionRequest;
  config: HyperliquidTestnetExecutorConfig;
  fetchImpl?: typeof fetch;
}): Promise<HyperliquidTestnetOrderArtifact> {
  const response = await fetchImpl(
    `${config.executorUrl}/v1/hyperliquid/testnet/orders`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.executorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildHyperliquidTestnetExecutorRequest(request, config)),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).error === "string"
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new Error(`Hyperliquid testnet executor rejected the order: ${message}`);
  }
  return normalizeHyperliquidTestnetOrderArtifact(body, request);
}

export async function submitHyperliquidTestnetKillSwitch({
  walletName,
  reason,
  config,
  fetchImpl = fetch,
}: {
  walletName: string;
  reason: string;
  config: HyperliquidTestnetExecutorConfig;
  fetchImpl?: typeof fetch;
}): Promise<HyperliquidTestnetKillSwitchArtifact> {
  const response = await fetchImpl(
    `${config.executorUrl}/v1/hyperliquid/testnet/kill-switch`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.executorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        buildHyperliquidTestnetKillSwitchRequest({
          walletName,
          reason,
          config,
        }),
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).error === "string"
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new Error(`Hyperliquid testnet executor rejected kill switch: ${message}`);
  }
  return normalizeHyperliquidTestnetKillSwitchArtifact(body);
}

export async function submitHyperliquidTestnetSettlement({
  serverRequestId,
  request,
  openingArtifact,
  config,
  fetchImpl = fetch,
  venueFetchImpl = fetch,
  sleep,
}: {
  serverRequestId: string;
  request: AgentServerExecutionRequest;
  openingArtifact: HyperliquidTestnetOrderArtifact;
  config: HyperliquidTestnetExecutorConfig;
  fetchImpl?: typeof fetch;
  venueFetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<HyperliquidTestnetSettlementArtifact> {
  const response = await fetchImpl(
    `${config.executorUrl}/v1/hyperliquid/testnet/settlements`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.executorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildHyperliquidTestnetSettlementRequest({
        serverRequestId,
        request,
        openingArtifact,
        config,
      })),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" &&
      typeof (body as Record<string, unknown>).error === "string"
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new Error(`Hyperliquid testnet executor rejected settlement: ${message}`);
  }
  const claim = normalizeHyperliquidTestnetSettlementArtifact(body, {
    serverRequestId,
    request,
    openingArtifact,
  });
  return verifyHyperliquidTestnetSettlementArtifact({
    claim,
    serverRequestId,
    request,
    openingArtifact,
    config,
    fetchImpl: venueFetchImpl,
    sleep,
  });
}

export async function verifyHyperliquidTestnetSettlementArtifact({
  claim,
  serverRequestId,
  request,
  openingArtifact,
  config,
  fetchImpl = fetch,
  sleep,
}: {
  claim: HyperliquidTestnetSettlementClaim;
  serverRequestId: string;
  request: AgentServerExecutionRequest;
  openingArtifact: HyperliquidTestnetOrderArtifact;
  config: HyperliquidTestnetExecutorConfig;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<HyperliquidTestnetSettlementArtifact> {
  if (
    claim.serverRequestId !== serverRequestId ||
    claim.openingOrderId !== openingArtifact.orderId ||
    claim.market !== request.market.toUpperCase() ||
    claim.side !== request.side ||
    claim.reservedNotionalUsd !== normalizeDecimal(request.notionalUsd)
  ) {
    throw new Error("Hyperliquid settlement claim does not match its approved execution request.");
  }
  const verified = await verifyHyperliquidTestnetSettlementEvidence({
    claim: {
      accountAddress: config.accountAddress,
      closingOrderId: claim.closingOrderId,
      market: claim.market,
      side: claim.side,
      closedSize: claim.closedSize,
      realizedPnlUsd: claim.realizedPnlUsd,
      fillHashes: claim.fillHashes,
      settledAt: claim.settledAt,
      queryStartTime: openingArtifact.submittedAt,
    },
    fetchImpl,
    sleep,
  });
  return { ...claim, ...verified };
}

export function normalizeHyperliquidTestnetOrderArtifact(
  input: unknown,
  request: AgentServerExecutionRequest,
): HyperliquidTestnetOrderArtifact {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? ((input as Record<string, unknown>).artifact ?? input)
      : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Hyperliquid testnet executor returned no order artifact.");
  }
  const record = source as Record<string, unknown>;
  const orderId = stringValue(record.orderId);
  const status = stringValue(record.status);
  const market = stringValue(record.market).toUpperCase();
  const side = stringValue(record.side);
  const submittedAt = numberValue(record.submittedAt);
  const filledSize = optionalDecimalString(record.filledSize);
  const averagePriceUsd = optionalDecimalString(record.averagePriceUsd);
  if (
    record.exchange !== "hyperliquid_testnet" ||
    !orderId ||
    !["accepted", "resting", "filled"].includes(status) ||
    market !== request.market.toUpperCase() ||
    side !== request.side ||
    !Number.isFinite(submittedAt) ||
    submittedAt <= 0
  ) {
    throw new Error("Hyperliquid testnet executor returned an invalid order artifact.");
  }
  return {
    exchange: "hyperliquid_testnet",
    orderId,
    status: status as HyperliquidTestnetOrderArtifact["status"],
    market,
    side: side as HyperliquidTestnetOrderArtifact["side"],
    filledSize,
    averagePriceUsd,
    submittedAt,
  };
}

export function normalizeHyperliquidTestnetSettlementArtifact(
  input: unknown,
  expected: {
    serverRequestId: string;
    request: AgentServerExecutionRequest;
    openingArtifact: HyperliquidTestnetOrderArtifact;
  },
): HyperliquidTestnetSettlementClaim {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? ((input as Record<string, unknown>).artifact ?? input)
    : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Hyperliquid testnet executor returned no settlement artifact.");
  }
  const row = source as Record<string, unknown>;
  const artifact: HyperliquidTestnetSettlementClaim = {
    exchange: "hyperliquid_testnet",
    network: "testnet",
    serverRequestId: stringValue(row.serverRequestId),
    openingOrderId: stringValue(row.openingOrderId),
    closingOrderId: stringValue(row.closingOrderId),
    market: stringValue(row.market).toUpperCase(),
    side: stringValue(row.side) as "long" | "short",
    closedSize: requiredDecimalString(row.closedSize, "closed size"),
    reservedNotionalUsd: requiredDecimalString(row.reservedNotionalUsd, "reserved notional"),
    realizedPnlUsd: signedDecimalString(row.realizedPnlUsd, "realized P/L"),
    fillHashes: Array.isArray(row.fillHashes)
      ? row.fillHashes.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : [],
    settledAt: numberValue(row.settledAt),
  };
  if (
    row.exchange !== artifact.exchange || row.network !== artifact.network ||
    artifact.serverRequestId !== expected.serverRequestId ||
    artifact.openingOrderId !== expected.openingArtifact.orderId ||
    artifact.market !== expected.request.market.toUpperCase() ||
    artifact.side !== expected.request.side ||
    !artifact.closingOrderId || artifact.fillHashes.length === 0 ||
    !Number.isFinite(artifact.settledAt) || artifact.settledAt <= 0 ||
    artifact.reservedNotionalUsd !== normalizeDecimal(expected.request.notionalUsd)
  ) {
    throw new Error("Hyperliquid testnet executor returned an invalid settlement artifact.");
  }
  return artifact;
}

export function normalizeHyperliquidTestnetKillSwitchArtifact(
  input: unknown,
): HyperliquidTestnetKillSwitchArtifact {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? ((input as Record<string, unknown>).artifact ?? input)
      : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Hyperliquid testnet executor returned no kill-switch artifact.");
  }
  const record = source as Record<string, unknown>;
  const status = stringValue(record.status);
  const cancelledAt = numberValue(record.cancelledAt);
  const message = stringValue(record.message);
  if (
    record.exchange !== "hyperliquid_testnet" ||
    !["accepted", "cancelled", "no_open_orders"].includes(status) ||
    !Number.isFinite(cancelledAt) ||
    cancelledAt <= 0 ||
    !message
  ) {
    throw new Error("Hyperliquid testnet executor returned an invalid kill-switch artifact.");
  }
  return {
    exchange: "hyperliquid_testnet",
    status: status as HyperliquidTestnetKillSwitchArtifact["status"],
    cancelledAt,
    message,
  };
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function decimalString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  return raw && Number.isFinite(Number(raw)) ? raw : null;
}

function optionalDecimalString(value: unknown): string | undefined {
  const parsed = decimalString(value);
  return parsed != null && Number(parsed) > 0 ? normalizeDecimal(parsed) : undefined;
}

function requiredDecimalString(value: unknown, label: string): string {
  const parsed = optionalDecimalString(value);
  if (!parsed) throw new Error(`Hyperliquid settlement ${label} is invalid.`);
  return parsed;
}

function signedDecimalString(value: unknown, label: string): string {
  const parsed = decimalString(value);
  if (parsed == null) throw new Error(`Hyperliquid settlement ${label} is invalid.`);
  return normalizeDecimal(parsed);
}

function normalizeDecimal(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return formatDecimal(parsed);
}

function parseHyperliquidPositions(
  input: unknown,
): HyperliquidTestnetPositionSnapshot[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const position = objectValue(objectValue(item)?.position);
      if (!position) return null;
      const coin = stringValue(position.coin).toUpperCase();
      const size = decimalString(position.szi);
      if (!coin || !size || Number(size) === 0) return null;
      const numericSize = Number(size);
      const unrealizedPnlUsd = decimalString(position.unrealizedPnl);
      const returnOnEquity = decimalString(position.returnOnEquity);
      return {
        market: `${coin}-PERP`,
        side: numericSize >= 0 ? "long" : "short",
        size,
        entryPriceUsd: decimalString(position.entryPx),
        positionValueUsd: decimalString(position.positionValue),
        unrealizedPnlUsd,
        returnOnEquityPct:
          returnOnEquity == null ? null : formatDecimal(Number(returnOnEquity) * 100),
        liquidationPriceUsd: decimalString(position.liquidationPx),
      };
    })
    .filter(
      (position): position is HyperliquidTestnetPositionSnapshot => position != null,
    );
}

function sumNullableMoney(values: Array<string | null>): string | null {
  const sum = values.reduce((total, value) => {
    const parsed = Number(value ?? 0);
    return total + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
  return sum === 0 && values.every((value) => value == null)
    ? null
    : formatDecimal(sum);
}

function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(8).replace(/\.?0+$/, "");
}
