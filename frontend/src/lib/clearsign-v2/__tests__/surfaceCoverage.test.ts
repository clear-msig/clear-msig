import { describe, expect, it } from "vitest";
import {
  CLEARSIGN_SURFACE_COVERAGE,
  clearSignSurfaceById,
} from "@/lib/clearsign-v2/surfaceCoverage";

describe("ClearSign surface coverage", () => {
  it("names every high-risk user action surface", () => {
    expect(CLEARSIGN_SURFACE_COVERAGE.map((surface) => surface.id)).toEqual([
      "sol-send",
      "sol-batch-send",
      "sol-escrow",
      "spl-escrow",
      "cross-chain-escrow",
      "private-escrow",
      "typed-approve-cancel",
      "btc-send",
      "eth-send",
      "hyperliquid-send",
      "erc20-send",
      "zec-send",
      "members-policy",
      "agent-trade-approval",
      "agent-settings",
    ]);
  });

  it("marks UI-wired native cross-chain sends as typed on-chain", () => {
    for (const id of [
      "btc-send",
      "eth-send",
      "hyperliquid-send",
      "zec-send",
    ]) {
      expect(clearSignSurfaceById(id)?.status).toBe("typed_onchain");
    }
    expect(clearSignSurfaceById("erc20-send")?.status).toBe(
      "legacy_custom_pending_typed_executor",
    );
  });

  it("keeps shipped SOL and escrow executors marked as typed on-chain", () => {
    for (const id of [
      "sol-send",
      "sol-batch-send",
      "sol-escrow",
      "spl-escrow",
      "cross-chain-escrow",
      "private-escrow",
      "typed-approve-cancel",
    ]) {
      expect(clearSignSurfaceById(id)?.status).toBe("typed_onchain");
    }
  });
});
