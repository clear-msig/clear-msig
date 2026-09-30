import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  createAgentVenueExecutionBridge, assertAgentVenueSubmissionPermit,
  type AgentVenueBridgePorts, type ExecutedAgentTradeAuthority,
  type ProtectedVenueReceipt, type ObservedVenueRisk,
} from "@/lib/agents/serverVenueBridge";
import { agentVenueDeliveryKey, agentVenueOrderCommitment, agentVenueOrderRoute, hashText,
  type AgentVenueOrderV2 } from "@/lib/agents/serverVenueOrderContract";

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
const now = 1_800_000_000_000;
const proposalPda = key(4);
function fixture() {
  const order: AgentVenueOrderV2 = {
    version: 2, chainGenesisHash: key(1), programId: key(2), walletPda: key(3), actionId: "trade-1",
    sessionIdHash: "a".repeat(64), agentIdHash: "b".repeat(64), policyCommitment: "c".repeat(64),
    riskCheckHash: "d".repeat(64), venue: "hyperliquid_testnet",
    accountAddress: `0x${"1".repeat(40)}`, agentWalletAddress: `0x${"2".repeat(40)}`,
    market: "BTC-PERP", side: "long", orderType: "market", notionalUsdRaw: "250000000",
    leverageX100: 100, leverageMode: "isolated", maxSlippageBps: 50,
    stopLossPrice: "60000", takeProfitPrice: "80000", expiresAtMs: now + 60000,
  };
  const authority: ExecutedAgentTradeAuthority = {
    finalized: true, chainGenesisHash: order.chainGenesisHash, ownerProgramId: order.programId,
    proposalPda, walletPda: order.walletPda, actionKind: 9, clearSignVersion: 4, status: "executed",
    approvals: 2, threshold: 2,
    canonical: { actionId: order.actionId, agentIdHash: order.agentIdHash, sessionIdHash: order.sessionIdHash,
      venueHash: hashText(order.venue), marketHash: hashText(order.market), sideHash: hashText(order.side),
      assetIdHash: hashText(`USDC:${order.venue}`), notionalUsdRaw: order.notionalUsdRaw,
      leverageX100: order.leverageX100, route: agentVenueOrderRoute(order), policyCommitment: order.policyCommitment,
      riskCheckHash: order.riskCheckHash, expiresAtMs: order.expiresAtMs },
    session: { walletPda: order.walletPda, sessionIdHash: order.sessionIdHash, agentIdHash: order.agentIdHash,
      policyCommitment: order.policyCommitment, venueHash: hashText(order.venue), marketHash: hashText(order.market),
      active: true, expiresAtMs: now + 120000, maxLeverageX100: 200, maxNotionalRaw: "500000000",
      spentNotionalRaw: "250000000" },
    risk: { walletPda: order.walletPda, sessionIdHash: order.sessionIdHash, active: true,
      maxLossRaw: "100000000", realizedLossRaw: "0", openNotionalRaw: "250000000" },
    limits: { policyCommitment: order.policyCommitment, maxOpenPositions: 2, cooldownMs: 1000,
      dailyLossCapRaw: "100000000", requireTakeProfit: true },
  };
  const observed: ObservedVenueRisk = {
    accountAddress: order.accountAddress, observedAtMs: now, reconciled: true, hasUnknownOrders: false,
    openPositionCount: 0, pendingReservationCount: 0, lastEntryAtMs: null,
    dailyRealizedLossRaw: "0", markPrice: "70000",
  };
  const deliveryKey = agentVenueDeliveryKey(order, proposalPda);
  const receipt: ProtectedVenueReceipt = { deliveryKey, commitment: agentVenueOrderCommitment(order),
    walletPda: order.walletPda, proposalPda, accountAddress: order.accountAddress,
    entryOrderId: "entry-1", stopLossOrderId: "stop-1", takeProfitOrderId: "take-1",
    protectionVerified: true, observedAtMs: now };
  const ports: AgentVenueBridgePorts = {
    deployment: { chainGenesisHash: order.chainGenesisHash, programId: order.programId },
    now: () => now,
    readDedicatedBinding: vi.fn(async () => ({ walletPda: order.walletPda, accountAddress: order.accountAddress,
      agentWalletAddress: order.agentWalletAddress, assignedWalletPdas: [order.walletPda] })),
    readFinalizedTradeAuthority: vi.fn(async () => structuredClone(authority)),
    readObservedRisk: vi.fn(async () => structuredClone(observed)),
    ledger: {
      claim: vi.fn(async () => ({ state: "acquired" as const, leaseId: "lease-1" })),
      complete: vi.fn(async () => undefined), blockBeforeSubmission: vi.fn(async () => undefined),
      markUncertain: vi.fn(async () => undefined),
    },
    venue: {
      supportsAtomicProtection: true,
      submitProtectedOrder: vi.fn(async ({ order: submitted, permit }) => {
        assertAgentVenueSubmissionPermit(permit, submitted, deliveryKey);
      }),
      reconcile: vi.fn(async () => structuredClone(receipt)),
    },
  };
  return { order, authority, observed, ports, receipt, deliveryKey,
    execute: () => createAgentVenueExecutionBridge(ports).execute({ order, proposalPda }) };
}

describe("canonical threshold-authorized venue bridge contract", () => {
  it("submits only after dedicated binding, current threshold evidence, reservation, and fresh risk", async () => {
    const f = fixture();
    await expect(f.execute()).resolves.toEqual(f.receipt);
    expect(f.ports.readFinalizedTradeAuthority).toHaveBeenCalledTimes(3);
    expect(f.ports.ledger.claim).toHaveBeenCalledWith(f.deliveryKey, f.receipt.commitment, f.order.accountAddress);
    expect(f.ports.venue.submitProtectedOrder).toHaveBeenCalledTimes(1);
    expect(f.ports.ledger.complete).toHaveBeenCalledWith(f.deliveryKey, "lease-1", f.receipt);
    const permit = vi.mocked(f.ports.venue.submitProtectedOrder).mock.calls[0][0].permit;
    expect(() => assertAgentVenueSubmissionPermit(permit, f.order, f.deliveryKey)).toThrow("permit");
  });

  it("does not accept a forgeable JSON execution permit", () => {
    const f = fixture();
    expect(() => assertAgentVenueSubmissionPermit({}, f.order, f.deliveryKey)).toThrow("permit");
  });

  it("does not let a caller select another deployment or wallet's shared account", async () => {
    const wrongDeployment = fixture();
    wrongDeployment.order.programId = key(8);
    await expect(wrongDeployment.execute()).rejects.toThrow("deployment");
    const f = fixture();
    vi.mocked(f.ports.readDedicatedBinding).mockResolvedValue({ walletPda: f.order.walletPda,
      accountAddress: f.order.accountAddress, agentWalletAddress: f.order.agentWalletAddress,
      assignedWalletPdas: [f.order.walletPda, key(8)] });
    await expect(f.execute()).rejects.toThrow("dedicated venue account");
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });

  it.each(["notFinalized", "threshold", "wrongWallet", "wrongProposal", "legacyRoute", "changedOrder"])("rejects %s authority", async (kind) => {
    const f = fixture();
    if (kind === "notFinalized") f.authority.finalized = false;
    if (kind === "threshold") f.authority.approvals = 1;
    if (kind === "wrongWallet") f.authority.walletPda = key(8);
    if (kind === "wrongProposal") f.authority.proposalPda = key(8);
    if (kind === "legacyRoute") f.authority.canonical.route = "hyperliquid_testnet:market";
    if (kind === "changedOrder") f.order.stopLossPrice = "59000";
    await expect(f.execute()).rejects.toThrow();
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });

  it.each(["revoked", "expired", "policy", "lossCap", "unreserved"])("rechecks %s after preparing and claiming", async (kind) => {
    const f = fixture();
    const initial = structuredClone(f.authority);
    if (kind === "revoked") f.authority.session.active = false;
    if (kind === "expired") f.authority.session.expiresAtMs = now;
    if (kind === "policy") f.authority.session.policyCommitment = "e".repeat(64);
    if (kind === "lossCap") f.authority.risk.realizedLossRaw = f.authority.risk.maxLossRaw;
    if (kind === "unreserved") f.authority.risk.openNotionalRaw = "0";
    vi.mocked(f.ports.readFinalizedTradeAuthority).mockResolvedValueOnce(initial);
    await expect(f.execute()).rejects.toThrow();
    expect(f.ports.ledger.blockBeforeSubmission).toHaveBeenCalled();
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });

  it.each(["stale", "unknownOrders", "positions", "pending", "loss", "cooldown", "stopDirection"])("rejects unsafe observed venue risk: %s", async (kind) => {
    const f = fixture();
    if (kind === "stale") f.observed.observedAtMs -= 20000;
    if (kind === "unknownOrders") f.observed.hasUnknownOrders = true;
    if (kind === "positions") f.observed.openPositionCount = 2;
    if (kind === "pending") f.observed.pendingReservationCount = 2;
    if (kind === "loss") f.observed.dailyRealizedLossRaw = "100000000";
    if (kind === "cooldown") f.observed.lastEntryAtMs = now;
    if (kind === "stopDirection") f.observed.markPrice = "50000";
    await expect(f.execute()).rejects.toThrow("venue risk");
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });

  it("requires atomic protective-order support", async () => {
    const f = fixture();
    f.ports.venue.supportsAtomicProtection = false;
    await expect(f.execute()).rejects.toThrow("atomic stop-loss");
    expect(f.ports.ledger.claim).not.toHaveBeenCalled();
  });

  it("catches revocation while the venue-risk request was in flight", async () => {
    const f = fixture();
    vi.mocked(f.ports.readObservedRisk).mockImplementation(async () => {
      f.authority.session.active = false;
      return f.observed;
    });
    await expect(f.execute()).rejects.toThrow("grant");
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });

  it("marks an ambiguous result uncertain and never retries the side effect", async () => {
    const f = fixture();
    vi.mocked(f.ports.venue.submitProtectedOrder).mockRejectedValue(new Error("timeout"));
    await expect(f.execute()).rejects.toThrow("timeout");
    expect(f.ports.ledger.markUncertain).toHaveBeenCalledWith(f.deliveryKey, "lease-1");
    vi.mocked(f.ports.ledger.claim).mockResolvedValue({ state: "uncertain" });
    vi.mocked(f.ports.venue.reconcile).mockResolvedValue(null);
    await expect(f.execute()).rejects.toThrow("reconciliation");
    expect(f.ports.venue.submitProtectedOrder).toHaveBeenCalledTimes(1);
  });

  it("reconciles an uncertain outcome without submitting another order", async () => {
    const f = fixture();
    vi.mocked(f.ports.ledger.claim).mockResolvedValue({ state: "uncertain" });
    await expect(f.execute()).resolves.toEqual(f.receipt);
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
    expect(f.ports.ledger.complete).toHaveBeenCalledWith(f.deliveryKey, null, f.receipt);
  });

  it("returns durable duplicate receipts without a side effect", async () => {
    const f = fixture();
    vi.mocked(f.ports.ledger.claim).mockResolvedValue({ state: "completed", receipt: f.receipt });
    await expect(f.execute()).resolves.toEqual(f.receipt);
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });

  it("does not treat an entry fill without verified stop protection as success", async () => {
    const f = fixture();
    f.receipt.protectionVerified = false;
    await expect(f.execute()).rejects.toThrow("protection");
    expect(f.ports.ledger.complete).not.toHaveBeenCalled();
    expect(f.ports.ledger.markUncertain).toHaveBeenCalled();
  });

  it("fails before submission when durable reservation is unavailable", async () => {
    const f = fixture();
    vi.mocked(f.ports.ledger.claim).mockRejectedValue(new Error("ledger unavailable"));
    await expect(f.execute()).rejects.toThrow("ledger unavailable");
    expect(f.ports.venue.submitProtectedOrder).not.toHaveBeenCalled();
  });
});

describe("new order descriptor binding", () => {
  it("binds account, exact atomic size, protection and expiry without changing legacy route meaning", () => {
    const f = fixture();
    const commitment = agentVenueOrderCommitment(f.order);
    for (const changed of [{ accountAddress: `0x${"3".repeat(40)}` }, { notionalUsdRaw: "250000001" },
      { stopLossPrice: "59999.99999999" }, { expiresAtMs: now + 61000 }]) {
      expect(agentVenueOrderCommitment({ ...f.order, ...changed })).not.toBe(commitment);
    }
    expect(agentVenueOrderRoute(f.order)).toMatch(/^hl-order-v2:[a-f0-9]{64}$/);
    expect(agentVenueOrderRoute(f.order).length).toBeLessThanOrEqual(96);
  });

  it("rejects missing stop losses, floating atomic amounts and unsupported cross margin", () => {
    const f = fixture();
    for (const changed of [{ stopLossPrice: "" }, { notionalUsdRaw: "1.1" }, { leverageMode: "cross" }, { version: 1 }]) {
      expect(() => agentVenueOrderCommitment({ ...f.order, ...changed } as AgentVenueOrderV2)).toThrow();
    }
  });
});
