import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  assertVenueLimitsBinding,
  validateVenueLimitsManifest,
  venueLimitsCommitment,
  venueUsdToRaw,
  type VenueLimitsManifestV1,
} from "../venueLimitsManifest";
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
function fixture(): VenueLimitsManifestV1 {
  // Synthetic bounds only; these values are never application defaults.
  return {
    kind: "clearsig.agent.venue-limits",
    version: 1,
    chainGenesisHash: key(1),
    programId: key(2),
    walletPda: key(3),
    intentPda: key(4),
    agentIdHash: "a".repeat(64),
    approvalThreshold: 2,
    enabled: true,
    emergencyPaused: false,
    allowedVenues: ["hyperliquid_testnet"],
    allowedMarkets: ["ETH-PERP", "BTC-PERP"],
    maxNotionalUsdRaw: "250000000",
    maxLeverageX100: 200,
    requireStopLoss: true,
    requireTakeProfit: false,
    maxOpenPositionsPerAgent: 1,
    cooldownSeconds: 300,
    maxSessionSeconds: 3600,
    dailyLossCapUsdRaw: "100000000",
    dailyLossWindow: "calendar_day",
    dailyLossTimeZone: "UTC",
    lossBasis: "realized_gross",
    lossAggregation: "net_pnl",
    cooldownStart: "entry_fill",
    executionMode: "single_full_close",
  };
}
const context = (manifest: VenueLimitsManifestV1) => ({
  commitment: venueLimitsCommitment(manifest),
  chainGenesisHash: manifest.chainGenesisHash,
  programId: manifest.programId,
  walletPda: manifest.walletPda,
  intentPda: manifest.intentPda,
  agentIdHash: manifest.agentIdHash,
  approvalThreshold: manifest.approvalThreshold,
});
describe("versioned venue-limit commitments (not execution authority)", () => {
  it("canonicalizes allowlist order and copies immutable controls", () => {
    const input = fixture();
    const validated = validateVenueLimitsManifest(input);
    expect(validated.allowedMarkets).toEqual(["BTC-PERP", "ETH-PERP"]);
    expect(venueLimitsCommitment(input)).toBe(
      venueLimitsCommitment({
        ...input,
        allowedMarkets: [...input.allowedMarkets].reverse(),
      }),
    );
    input.maxNotionalUsdRaw = "1";
    expect(validated.maxNotionalUsdRaw).toBe("250000000");
    expect(Object.isFrozen(validated.allowedMarkets)).toBe(true);
  });
  it.each([
    "dailyLossWindow",
    "dailyLossTimeZone",
    "lossBasis",
    "lossAggregation",
    "cooldownStart",
    "executionMode",
    "requireTakeProfit",
    "dailyLossCapUsdRaw",
    "approvalThreshold",
  ])("rejects missing %s rather than authorizing a default", (field) => {
    const input = { ...fixture() } as Record<string, unknown>;
    delete input[field];
    expect(() => validateVenueLimitsManifest(input)).toThrow("missing");
  });
  it.each([
    { version: 2 },
    { dailyLossWindow: "rolling_24h" },
    { dailyLossTimeZone: "Mars/Olympus" },
    { lossBasis: "realized_net_fees_funding" },
    { lossAggregation: "losses_only" },
    { cooldownStart: "full_close" },
    { extra: true },
    { allowedMarkets: [] },
    { allowedMarkets: ["BTC-PERP", "BTC-PERP"] },
    { allowedVenues: ["mock_perps"] },
    { requireStopLoss: false },
    { requireTakeProfit: "false" },
    { maxLeverageX100: 100.5 },
    { maxOpenPositionsPerAgent: 2 },
    { maxSessionSeconds: 0 },
    { dailyLossCapUsdRaw: "1.1" },
    { maxNotionalUsdRaw: (1n << 128n).toString() },
  ])("rejects unsupported or unsafe controls %j", (change) => {
    expect(() =>
      validateVenueLimitsManifest({ ...fixture(), ...change }),
    ).toThrow();
  });
  it.each([
    { chainGenesisHash: key(5) },
    { programId: key(5) },
    { walletPda: key(5) },
    { intentPda: key(5) },
    { agentIdHash: "b".repeat(64) },
    { approvalThreshold: 1 },
  ])("rejects replay under a different governance context %j", (change) => {
    const manifest = fixture();
    expect(() =>
      assertVenueLimitsBinding(manifest, { ...context(manifest), ...change }),
    ).toThrow("approved governance");
  });
  it.each([
    { dailyLossCapUsdRaw: "100000001" },
    { maxNotionalUsdRaw: "250000001" },
    { cooldownSeconds: 301 },
    { maxSessionSeconds: 3601 },
    { maxLeverageX100: 201 },
    { requireTakeProfit: true },
    { dailyLossTimeZone: "America/New_York" },
    { executionMode: "allocated_partial_close" },
  ])("binds changed risk/economic fields %j", (change) => {
    const manifest = fixture();
    expect(() =>
      assertVenueLimitsBinding({ ...manifest, ...change }, context(manifest)),
    ).toThrow("approved governance");
  });
  it.each([{ enabled: false }, { emergencyPaused: true }])(
    "does not make a correctly hashed disabled policy usable %j",
    (change) => {
      const manifest = { ...fixture(), ...change };
      expect(() =>
        assertVenueLimitsBinding(manifest, context(manifest)),
      ).toThrow("disabled or paused");
    },
  );
  it("rejects legacy browser policy hashes as v1 manifest commitments", () => {
    const manifest = fixture();
    expect(() =>
      assertVenueLimitsBinding(manifest, {
        ...context(manifest),
        commitment: "c".repeat(64),
      }),
    ).toThrow("approved governance");
  });
  it("converts USD without floating point or silent rounding", () => {
    expect(venueUsdToRaw("9007199254740993.000001")).toBe(
      "9007199254740993000001",
    );
    expect(venueUsdToRaw("0.000001")).toBe("1");
    for (const input of [
      "0",
      "0.0000001",
      "1.0000000",
      "1e3",
      "-1",
      "01",
      "1 ",
    ])
      expect(() => venueUsdToRaw(input)).toThrow();
  });
});
