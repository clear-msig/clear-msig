import { PublicKey } from "@solana/web3.js";
import { sha256, toHex } from "@/lib/msig/hash";

/** Signing-compatible data only. A hash is not approval and never enables execution. */
export interface VenueLimitsManifestV1 {
  kind: "clearsig.agent.venue-limits";
  version: 1;
  chainGenesisHash: string;
  programId: string;
  walletPda: string;
  intentPda: string;
  agentIdHash: string;
  approvalThreshold: number;
  enabled: boolean;
  emergencyPaused: boolean;
  allowedVenues: readonly "hyperliquid_testnet"[];
  allowedMarkets: readonly string[];
  maxNotionalUsdRaw: string;
  maxLeverageX100: number;
  requireStopLoss: true;
  requireTakeProfit: boolean;
  maxOpenPositionsPerAgent: number;
  cooldownSeconds: number;
  maxSessionSeconds: number;
  dailyLossCapUsdRaw: string;
  /** All economic choices are explicit. No validator-selected policy defaults. */
  dailyLossWindow: "calendar_day";
  dailyLossTimeZone: string;
  lossBasis: "realized_gross";
  lossAggregation: "net_pnl";
  cooldownStart: "entry_fill";
  executionMode: "single_full_close" | "allocated_partial_close";
}

const FIELDS = [
  "kind",
  "version",
  "chainGenesisHash",
  "programId",
  "walletPda",
  "intentPda",
  "agentIdHash",
  "approvalThreshold",
  "enabled",
  "emergencyPaused",
  "allowedVenues",
  "allowedMarkets",
  "maxNotionalUsdRaw",
  "maxLeverageX100",
  "requireStopLoss",
  "requireTakeProfit",
  "maxOpenPositionsPerAgent",
  "cooldownSeconds",
  "maxSessionSeconds",
  "dailyLossCapUsdRaw",
  "dailyLossWindow",
  "dailyLossTimeZone",
  "lossBasis",
  "lossAggregation",
  "cooldownStart",
  "executionMode",
] as const;
const U128_MAX = (1n << 128n) - 1n;

export function validateVenueLimitsManifest(
  input: unknown,
): Readonly<VenueLimitsManifestV1> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Venue limits manifest required.");
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).length !== FIELDS.length ||
    FIELDS.some((field) => !Object.hasOwn(row, field)) ||
    row.kind !== "clearsig.agent.venue-limits" ||
    row.version !== 1
  )
    throw new Error("Unknown, missing or unsupported venue-limit fields.");
  for (const field of [
    "chainGenesisHash",
    "programId",
    "walletPda",
    "intentPda",
  ] as const) {
    if (
      typeof row[field] !== "string" ||
      new PublicKey(row[field]).toBase58() !== row[field]
    )
      throw new Error("Canonical deployment/governance identity required.");
  }
  if (
    typeof row.agentIdHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.agentIdHash) ||
    /^0+$/.test(row.agentIdHash)
  )
    throw new Error("Canonical agent identity required.");
  integer(row.approvalThreshold, 1, 16);
  integer(row.maxLeverageX100, 100, 0xffffffff);
  integer(row.maxOpenPositionsPerAgent, 1, 0xffffffff);
  integer(row.cooldownSeconds, 0, 0xffffffff);
  integer(row.maxSessionSeconds, 1, 0xffffffff);
  for (const field of [
    "enabled",
    "emergencyPaused",
    "requireTakeProfit",
  ] as const)
    if (typeof row[field] !== "boolean")
      throw new Error("Explicit boolean risk controls required.");
  if (row.requireStopLoss !== true)
    throw new Error("Strict stop-loss protection cannot be disabled.");
  positiveRaw(row.maxNotionalUsdRaw);
  positiveRaw(row.dailyLossCapUsdRaw);
  const allowedVenues = canonicalSet(
    row.allowedVenues,
    (value) => value === "hyperliquid_testnet",
  );
  const allowedMarkets = canonicalSet(row.allowedMarkets, (value) =>
    /^[A-Z0-9]{1,20}-PERP$/.test(value),
  );
  choice(row.dailyLossWindow, ["calendar_day"]);
  if (
    typeof row.dailyLossTimeZone !== "string" ||
    row.dailyLossTimeZone.length > 64 ||
    !/^(UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(row.dailyLossTimeZone)
  )
    throw new Error("Explicit IANA daily-loss reset timezone required.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: row.dailyLossTimeZone }).format(
      0,
    );
  } catch {
    throw new Error("Unsupported daily-loss reset timezone.");
  }
  choice(row.lossBasis, ["realized_gross"]);
  choice(row.lossAggregation, ["net_pnl"]);
  choice(row.cooldownStart, ["entry_fill"]);
  choice(row.executionMode, ["single_full_close", "allocated_partial_close"]);
  if (
    row.executionMode === "single_full_close" &&
    row.maxOpenPositionsPerAgent !== 1
  )
    throw new Error("Single-execution mode requires a one-position bound.");
  const canonical = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      field === "allowedMarkets"
        ? allowedMarkets
        : field === "allowedVenues"
          ? allowedVenues
          : row[field],
    ]),
  ) as unknown as VenueLimitsManifestV1;
  if (new TextEncoder().encode(JSON.stringify(canonical)).length > 8192)
    throw new Error("Venue limits manifest exceeds its format bound.");
  return Object.freeze(canonical);
}

export function venueLimitsCommitment(input: unknown): string {
  const canonical = validateVenueLimitsManifest(input);
  return toHex(
    sha256(
      new TextEncoder().encode(
        `clearsig.agent.venue-limits.v1\0${JSON.stringify(canonical)}`,
      ),
    ),
  );
}

/** Compare with trusted finalized governance context; this function itself proves no signature. */
export function assertVenueLimitsBinding(
  input: unknown,
  expected: {
    commitment: string;
    chainGenesisHash: string;
    programId: string;
    walletPda: string;
    intentPda: string;
    agentIdHash: string;
    approvalThreshold: number;
  },
): Readonly<VenueLimitsManifestV1> {
  const manifest = validateVenueLimitsManifest(input);
  if (
    venueLimitsCommitment(manifest) !== expected.commitment ||
    (
      [
        "chainGenesisHash",
        "programId",
        "walletPda",
        "intentPda",
        "agentIdHash",
        "approvalThreshold",
      ] as const
    ).some((field) => manifest[field] !== expected[field])
  )
    throw new Error(
      "Venue limits differ from the approved governance commitment.",
    );
  if (!manifest.enabled || manifest.emergencyPaused)
    throw new Error("Venue policy is disabled or paused.");
  return manifest;
}

/** USD inputs are six-decimal atomic values; reject, never round, excess precision. */
export function venueUsdToRaw(value: string): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,6})?$/.test(value)
  )
    throw new Error("Exact USD value with at most six decimals required.");
  const [whole, fraction = ""] = value.split(".");
  const raw = (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0"))
  ).toString();
  positiveRaw(raw);
  return raw;
}
function integer(value: unknown, min: number, max: number): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error("Explicit bounded integer control required.");
}
function positiveRaw(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,38}$/.test(value) ||
    BigInt(value) > U128_MAX
  )
    throw new Error("Positive exact u128 amount required.");
}
function choice(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error("Explicit supported economic policy choice required.");
}
function canonicalSet(
  input: unknown,
  accepts: (value: string) => boolean,
): readonly string[] {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > 256 ||
    input.some((value) => typeof value !== "string" || !accepts(value)) ||
    new Set(input).size !== input.length
  )
    throw new Error(
      "Explicit nonempty unique venue/market allowlist required.",
    );
  return Object.freeze([...input].sort());
}
