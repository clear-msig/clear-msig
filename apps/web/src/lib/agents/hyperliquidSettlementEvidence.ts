import { createHash } from "crypto";

const HYPERLIQUID_TESTNET_INFO_URL = "https://api.hyperliquid-testnet.xyz/info";
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_FILL_ATTEMPTS = 5;
const FILL_RETRY_DELAY_MS = 250;
const MAX_SETTLEMENT_CLOCK_SKEW_MS = 120_000;

export interface HyperliquidVenueSettlementFill {
  transactionHash: string;
  tradeId: string;
  orderId: string;
  market: string;
  direction: string;
  side: "A" | "B";
  size: string;
  priceUsd: string;
  closedPnlUsd: string;
  filledAt: number;
}

export interface HyperliquidVenueSettlementEvidence {
  version: 1;
  source: "hyperliquid_info_api";
  network: "testnet";
  accountAddress: string;
  orderId: string;
  orderStatus: "filled";
  orderStatusTimestamp: number;
  fills: HyperliquidVenueSettlementFill[];
  evidenceHash: string;
}

export interface HyperliquidSettlementClaim {
  accountAddress: string;
  closingOrderId: string;
  market: string;
  side: "long" | "short";
  closedSize: string;
  realizedPnlUsd: string;
  fillHashes: string[];
  settledAt: number;
  queryStartTime: number;
}

export interface VerifiedHyperliquidSettlement {
  closedSize: string;
  realizedPnlUsd: string;
  fillHashes: string[];
  settledAt: number;
  venueEvidence: HyperliquidVenueSettlementEvidence;
}

export async function verifyHyperliquidTestnetSettlementEvidence({
  claim,
  fetchImpl = fetch,
  sleep = defaultSleep,
}: {
  claim: HyperliquidSettlementClaim;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<VerifiedHyperliquidSettlement> {
  const accountAddress = claim.accountAddress.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(accountAddress)) {
    throw new Error("Hyperliquid settlement account address is invalid.");
  }
  const orderId = integerString(claim.closingOrderId, "closing order id");
  const market = marketCoin(claim.market);
  const expectedSide: "A" | "B" = claim.side === "long" ? "A" : "B";
  const expectedDirection = claim.side === "long" ? "Close Long" : "Close Short";

  const orderStatusResponse = await postInfo(
    { type: "orderStatus", user: accountAddress, oid: orderId },
    fetchImpl,
  );
  const orderStatus = parseOrderStatus(orderStatusResponse);
  if (
    orderStatus.status !== "filled" ||
    orderStatus.orderId !== orderId ||
    orderStatus.market !== market ||
    orderStatus.side !== expectedSide
  ) {
    throw new Error("Hyperliquid did not confirm the claimed closing order as filled.");
  }

  let matchingFills: HyperliquidVenueSettlementFill[] = [];
  for (let attempt = 0; attempt < MAX_FILL_ATTEMPTS; attempt += 1) {
    const fillsResponse = await postInfo(
      {
        type: "userFillsByTime",
        user: accountAddress,
        startTime: claim.queryStartTime,
        endTime: Math.max(claim.settledAt, orderStatus.timestamp) + MAX_SETTLEMENT_CLOCK_SKEW_MS,
        aggregateByTime: false,
      },
      fetchImpl,
    );
    matchingFills = parseVenueFills(fillsResponse).filter(
      (fill) =>
        fill.orderId === orderId &&
        fill.market === market &&
        fill.side === expectedSide &&
        fill.direction === expectedDirection,
    );
    if (matchingFills.length > 0) break;
    if (attempt < MAX_FILL_ATTEMPTS - 1) {
      await sleep(FILL_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  if (matchingFills.length === 0) {
    throw new Error("Hyperliquid returned no matching native fills for the closing order.");
  }

  matchingFills.sort(
    (left, right) => left.filledAt - right.filledAt || left.tradeId.localeCompare(right.tradeId),
  );
  const closedSize = sumDecimals(matchingFills.map((fill) => fill.size));
  const realizedPnlUsd = sumDecimals(matchingFills.map((fill) => fill.closedPnlUsd));
  const fillHashes = unique(matchingFills.map((fill) => fill.transactionHash));
  const settledAt = Math.max(...matchingFills.map((fill) => fill.filledAt));

  if (
    canonicalDecimal(claim.closedSize) !== closedSize ||
    canonicalDecimal(claim.realizedPnlUsd) !== realizedPnlUsd ||
    !sameStrings(unique(claim.fillHashes.map(normalizeTransactionHash)), fillHashes) ||
    Math.abs(claim.settledAt - settledAt) > MAX_SETTLEMENT_CLOCK_SKEW_MS
  ) {
    throw new Error("Executor settlement fields do not match Hyperliquid native fill evidence.");
  }

  const evidenceBody = {
    version: 1 as const,
    source: "hyperliquid_info_api" as const,
    network: "testnet" as const,
    accountAddress,
    orderId,
    orderStatus: "filled" as const,
    orderStatusTimestamp: orderStatus.timestamp,
    fills: matchingFills,
  };
  const venueEvidence: HyperliquidVenueSettlementEvidence = {
    ...evidenceBody,
    evidenceHash: createHash("sha256").update(stableJson(evidenceBody)).digest("hex"),
  };
  return { closedSize, realizedPnlUsd, fillHashes, settledAt, venueEvidence };
}

async function postInfo(body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(HYPERLIQUID_TESTNET_INFO_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid settlement evidence request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function parseOrderStatus(input: unknown): {
  status: string;
  orderId: string;
  market: string;
  side: string;
  timestamp: number;
} {
  const root = objectValue(input);
  const statusEnvelope = objectValue(root?.order);
  const order = objectValue(statusEnvelope?.order);
  const timestamp = safeInteger(statusEnvelope?.statusTimestamp, "order status timestamp");
  return {
    status: stringValue(statusEnvelope?.status),
    orderId: integerString(order?.oid, "order status id"),
    market: stringValue(order?.coin).toUpperCase(),
    side: stringValue(order?.side),
    timestamp,
  };
}

function parseVenueFills(input: unknown): HyperliquidVenueSettlementFill[] {
  if (!Array.isArray(input)) throw new Error("Hyperliquid returned an invalid fills response.");
  return input.map((item) => {
    const fill = objectValue(item);
    const side = stringValue(fill?.side);
    if (side !== "A" && side !== "B") {
      throw new Error("Hyperliquid returned an invalid fill side.");
    }
    return {
      transactionHash: normalizeTransactionHash(stringValue(fill?.hash)),
      tradeId: integerString(fill?.tid, "fill trade id"),
      orderId: integerString(fill?.oid, "fill order id"),
      market: stringValue(fill?.coin).toUpperCase(),
      direction: stringValue(fill?.dir),
      side,
      size: positiveDecimal(fill?.sz, "fill size"),
      priceUsd: positiveDecimal(fill?.px, "fill price"),
      closedPnlUsd: canonicalDecimal(fill?.closedPnl),
      filledAt: safeInteger(fill?.time, "fill timestamp"),
    };
  });
}

function marketCoin(value: string): string {
  const normalized = value.trim().toUpperCase();
  const coin = normalized.endsWith("-PERP") ? normalized.slice(0, -5) : normalized;
  if (!/^[A-Z0-9:_-]{1,32}$/.test(coin)) throw new Error("Hyperliquid market is invalid.");
  return coin;
}

function normalizeTransactionHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized) || /^0x0{64}$/.test(normalized)) {
    throw new Error("Hyperliquid fill transaction hash is invalid.");
  }
  return normalized;
}

function integerString(value: unknown, label: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Hyperliquid ${label} is invalid.`);
    return String(value);
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,20}$/.test(normalized)) throw new Error(`Hyperliquid ${label} is invalid.`);
  return normalized.replace(/^0+(?=\d)/, "");
}

function safeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Hyperliquid ${label} is invalid.`);
  return parsed;
}

function positiveDecimal(value: unknown, label: string): string {
  const normalized = canonicalDecimal(value);
  if (normalized === "0" || normalized.startsWith("-")) {
    throw new Error(`Hyperliquid ${label} is invalid.`);
  }
  return normalized;
}

function canonicalDecimal(value: unknown): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  const match = /^(-?)(\d{1,38})(?:\.(\d{1,18}))?$/.exec(raw);
  if (!match) throw new Error("Hyperliquid decimal value is invalid.");
  const whole = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const magnitude = fraction ? `${whole}.${fraction}` : whole;
  return magnitude === "0" ? "0" : `${match[1]}${magnitude}`;
}

function sumDecimals(values: string[]): string {
  const parsed = values.map((value) => decimalParts(canonicalDecimal(value)));
  const scale = Math.max(...parsed.map((value) => value.scale));
  const atoms = parsed.reduce(
    (total, value) => total + value.atoms * 10n ** BigInt(scale - value.scale),
    0n,
  );
  return decimalFromAtoms(atoms, scale);
}

function decimalParts(value: string): { atoms: bigint; scale: number } {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const atoms = BigInt(`${whole}${fraction}` || "0") * (negative ? -1n : 1n);
  return { atoms, scale: fraction.length };
}

function decimalFromAtoms(atoms: bigint, scale: number): string {
  const negative = atoms < 0n;
  const digits = (negative ? -atoms : atoms).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  const magnitude = fraction ? `${whole}.${fraction}` : whole;
  return atoms === 0n ? "0" : `${negative ? "-" : ""}${magnitude}`;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
