import { describe, expect, it } from "vitest";
import {
  CLEARSIGN_SURFACE_COVERAGE,
  clearSignSurfaceById,
} from "@/lib/clearsign/surfaceCoverage";

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
      "wallet-policy",
      "members-policy",
      "agent-trade-approval",
      "agent-session-grant",
      "agent-risk-policy",
      "agent-trade-settlement",
      "member-allowances",
      "agent-settings",
    ]);
  });

  it("marks UI-wired native cross-chain sends as typed on-chain", () => {
    for (const id of [
      "btc-send",
      "eth-send",
      "hyperliquid-send",
      "zec-send",
      "erc20-send",
    ]) {
      expect(clearSignSurfaceById(id)?.status).toBe("typed_onchain");
    }
  });

  it("marks membership and wallet policy as typed on-chain", () => {
    expect(clearSignSurfaceById("wallet-policy")?.status).toBe("typed_onchain");
    expect(clearSignSurfaceById("members-policy")?.status).toBe("typed_onchain");
  });

  it("separates product-wired executors from program-only escrow support", () => {
    for (const id of [
      "sol-send",
      "sol-batch-send",
      "sol-escrow",
      "typed-approve-cancel",
    ]) {
      expect(clearSignSurfaceById(id)?.status).toBe("typed_onchain");
    }
    for (const id of ["spl-escrow", "cross-chain-escrow", "private-escrow"]) {
      expect(clearSignSurfaceById(id)?.status).toBe("program_only");
    }
    expect(clearSignSurfaceById("agent-trade-settlement")?.status).toBe(
      "typed_onchain_owner_attested",
    );
  });
});
