import {
  agentVenueDeliveryKey, agentVenueOrderCommitment, agentVenueOrderRoute, hashText,
  compareExactPrices, nonnegativeRaw, positiveRaw, validateAgentVenueOrder, type AgentVenueOrderV2,
} from "./serverVenueOrderContract";

export interface DedicatedVenueBinding {
  walletPda: string;
  accountAddress: string;
  agentWalletAddress: string;
  /** Trusted registry query must include all wallet assignments for this account. */
  assignedWalletPdas: string[];
}

export interface ExecutedAgentTradeAuthority {
  finalized: boolean;
  chainGenesisHash: string;
  ownerProgramId: string;
  proposalPda: string;
  walletPda: string;
  actionKind: 9;
  clearSignVersion: 4;
  status: "executed";
  approvals: number;
  threshold: number;
  canonical: {
    actionId: string; agentIdHash: string; sessionIdHash: string;
    venueHash: string; marketHash: string; sideHash: string; assetIdHash: string;
    notionalUsdRaw: string; leverageX100: number; route: string;
    policyCommitment: string; riskCheckHash: string; expiresAtMs: number;
  };
  session: {
    walletPda: string; sessionIdHash: string; agentIdHash: string;
    policyCommitment: string; venueHash: string; marketHash: string;
    active: boolean; expiresAtMs: number; maxLeverageX100: number;
    maxNotionalRaw: string; spentNotionalRaw: string;
  };
  risk: {
    walletPda: string; sessionIdHash: string; active: boolean;
    maxLossRaw: string; realizedLossRaw: string; openNotionalRaw: string;
  };
  /** Resolved from an authoritative policy matching the canonical commitment. */
  limits: {
    policyCommitment: string; maxOpenPositions: number; cooldownMs: number;
    dailyLossCapRaw: string; requireTakeProfit: boolean;
  };
}

export interface ObservedVenueRisk {
  accountAddress: string;
  observedAtMs: number;
  reconciled: boolean;
  hasUnknownOrders: boolean;
  openPositionCount: number;
  pendingReservationCount: number;
  lastEntryAtMs: number | null;
  dailyRealizedLossRaw: string;
  markPrice: string;
}

export interface ProtectedVenueReceipt {
  deliveryKey: string;
  commitment: string;
  walletPda: string;
  proposalPda: string;
  accountAddress: string;
  entryOrderId: string;
  stopLossOrderId: string;
  takeProfitOrderId: string | null;
  protectionVerified: boolean;
  observedAtMs: number;
}

export type VenueDeliveryClaim =
  | { state: "acquired"; leaseId: string }
  | { state: "completed"; receipt: ProtectedVenueReceipt }
  | { state: "in_flight" }
  | { state: "uncertain" };

/** Trusted server ports only. Readers/storage exist; no production route is wired. */
export interface AgentVenueBridgePorts {
  /** Pinned server deployment, never supplied by the caller. */
  deployment: { chainGenesisHash: string; programId: string };
  now(): number;
  readDedicatedBinding(walletPda: string): Promise<DedicatedVenueBinding>;
  /** Must verify owner/layout/PDA and canonical v4 bytes from trusted RPC. */
  readFinalizedTradeAuthority(proposalPda: string, order: AgentVenueOrderV2): Promise<ExecutedAgentTradeAuthority>;
  readObservedRisk(accountAddress: string, excludingDeliveryKey: string): Promise<ObservedVenueRisk>;
  ledger: {
    /** Atomic durable compare/claim; account reservations serialize concurrent risk checks. */
    claim(deliveryKey: string, commitment: string, accountAddress: string): Promise<VenueDeliveryClaim>;
    lookup(deliveryKey: string, commitment: string, accountAddress: string): Promise<Exclude<VenueDeliveryClaim, { state: "acquired" }> | null>;
    beginSubmission(deliveryKey: string, leaseId: string): Promise<void>;
    complete(deliveryKey: string, leaseId: string | null, receipt: ProtectedVenueReceipt): Promise<void>;
    blockBeforeSubmission(deliveryKey: string, leaseId: string): Promise<void>;
    markUncertain(deliveryKey: string, leaseId: string): Promise<void>;
  };
  venue: {
    supportsAtomicProtection: boolean;
    /** Must place entry+reduce-only stop protection as one verified atomic action. */
    submitProtectedOrder(input: { order: AgentVenueOrderV2; clientOrderId: string; permit: object }): Promise<void>;
    /** Independent native venue reads; never trust only submit's response. */
    reconcile(deliveryKey: string, order: AgentVenueOrderV2): Promise<ProtectedVenueReceipt | null>;
  };
}

const MAX_RISK_AGE_MS = 15_000;
const permits = new WeakMap<object, { commitment: string; deliveryKey: string }>();

/** Adapter implementations can require this capability; wire JSON cannot forge it. */
export function assertAgentVenueSubmissionPermit(permit: object, order: AgentVenueOrderV2, deliveryKey: string): void {
  const authorized = permits.get(permit);
  if (!authorized || authorized.commitment !== agentVenueOrderCommitment(order) || authorized.deliveryKey !== deliveryKey) {
    throw new Error("A verified server execution permit is required.");
  }
}

/**
 * Complete orchestration against explicit trusted ports. Production readiness
 * remains blocked until committed limits and native protected venue adapters
 * are implemented and the complete integration is reviewed; unit-test ports do not enable routes.
 */
export function createAgentVenueExecutionBridge(ports: AgentVenueBridgePorts) {
  return {
    /** Recover an existing delivery even after its grant expires/revokes. Never grants send authority. */
    async reconcileExisting(input: { order: AgentVenueOrderV2; proposalPda: string }): Promise<ProtectedVenueReceipt> {
      const order = validateAgentVenueOrder(input.order);
      if (order.chainGenesisHash !== ports.deployment.chainGenesisHash || order.programId !== ports.deployment.programId) {
        throw new Error("Order does not belong to this trusted chain/program deployment.");
      }
      validateBinding(await ports.readDedicatedBinding(order.walletPda), order);
      const deliveryKey = agentVenueDeliveryKey(order, input.proposalPda);
      const commitment = agentVenueOrderCommitment(order);
      const existing = await ports.ledger.lookup(deliveryKey, commitment, order.accountAddress);
      if (!existing || existing.state === "in_flight") throw new Error("No uncertain or completed delivery is available for reconciliation.");
      const receipt = existing.state === "completed" ? existing.receipt : await ports.venue.reconcile(deliveryKey, order);
      if (!receipt) throw new Error("Venue outcome is uncertain; independent reconciliation is required.");
      validateReceipt(receipt, order, input.proposalPda, deliveryKey, commitment);
      if (existing.state !== "completed") await ports.ledger.complete(deliveryKey, null, receipt);
      return receipt;
    },
    async execute(input: { order: AgentVenueOrderV2; proposalPda: string }): Promise<ProtectedVenueReceipt> {
      const order = validateAgentVenueOrder(input.order);
      if (order.chainGenesisHash !== ports.deployment.chainGenesisHash || order.programId !== ports.deployment.programId) {
        throw new Error("Order does not belong to this trusted chain/program deployment.");
      }
      const deliveryKey = agentVenueDeliveryKey(order, input.proposalPda);
      const commitment = agentVenueOrderCommitment(order);
      if (!ports.venue.supportsAtomicProtection) throw new Error("Venue adapter cannot guarantee atomic stop-loss protection.");
      validateBinding(await ports.readDedicatedBinding(order.walletPda), order);
      validateAuthority(await ports.readFinalizedTradeAuthority(input.proposalPda, order), order, input.proposalPda, ports.now());
      const claim = await ports.ledger.claim(deliveryKey, commitment, order.accountAddress);
      if (claim.state === "completed") {
        validateReceipt(claim.receipt, order, input.proposalPda, deliveryKey, commitment);
        return claim.receipt;
      }
      if (claim.state === "in_flight") throw new Error("The authorized trade is already in flight.");
      if (claim.state === "uncertain") {
        const receipt = await ports.venue.reconcile(deliveryKey, order);
        if (!receipt) throw new Error("Venue outcome is uncertain; reconciliation is required before any retry.");
        validateReceipt(receipt, order, input.proposalPda, deliveryKey, commitment);
        await ports.ledger.complete(deliveryKey, null, receipt);
        return receipt;
      }
      if (!claim.leaseId) throw new Error("Durable delivery lease is missing.");
      let handoffStarted = false;
      const permit = Object.freeze({});
      try {
        // Re-read after acquiring the account-scoped reservation. Preparing a
        // proposal cannot preserve authority through a later revocation/expiry.
        validateBinding(await ports.readDedicatedBinding(order.walletPda), order);
        const authority = await ports.readFinalizedTradeAuthority(input.proposalPda, order);
        validateAuthority(authority, order, input.proposalPda, ports.now());
        const observed = await ports.readObservedRisk(order.accountAddress, deliveryKey);
        // Risk observation can itself await a provider. Recheck chain authority
        // after that wait, immediately before issuing the single-use capability.
        const finalAuthority = await ports.readFinalizedTradeAuthority(input.proposalPda, order);
        validateAuthority(finalAuthority, order, input.proposalPda, ports.now());
        validateObservedRisk(observed, finalAuthority, order, ports.now());
        if (order.expiresAtMs <= ports.now()) throw new Error("Trade authorization expired before submission.");
        // Persist the point after which a crash can never permit automatic resubmission.
        handoffStarted = true;
        await ports.ledger.beginSubmission(deliveryKey, claim.leaseId);
        // Storage can await a network request too. Never use stale risk or expiry after that wait.
        validateAuthority(finalAuthority, order, input.proposalPda, ports.now());
        validateObservedRisk(observed, finalAuthority, order, ports.now());
        permits.set(permit, { commitment, deliveryKey });
        await ports.venue.submitProtectedOrder({ order, clientOrderId: `0x${deliveryKey.slice(0, 32)}`, permit });
        const receipt = await ports.venue.reconcile(deliveryKey, order);
        if (!receipt) throw new Error("Submitted order lacks independently reconciled protection.");
        validateReceipt(receipt, order, input.proposalPda, deliveryKey, commitment);
        await ports.ledger.complete(deliveryKey, claim.leaseId, receipt);
        return receipt;
      } catch (error) {
        // A lost begin response may mean the durable transition succeeded. Never release it.
        try {
          if (handoffStarted) await ports.ledger.markUncertain(deliveryKey, claim.leaseId);
          else await ports.ledger.blockBeforeSubmission(deliveryKey, claim.leaseId);
        } catch {
          // Retain the original failure. A reserved/submitting record remains locked;
          // lease expiry can only make it uncertain, never sendable again.
        }
        throw error;
      } finally {
        permits.delete(permit);
      }
    },
  };
}

function validateBinding(binding: DedicatedVenueBinding, order: AgentVenueOrderV2): void {
  if (binding.walletPda !== order.walletPda || binding.accountAddress !== order.accountAddress ||
    binding.agentWalletAddress !== order.agentWalletAddress || binding.assignedWalletPdas.length !== 1 ||
    binding.assignedWalletPdas[0] !== order.walletPda) throw new Error("A dedicated venue account bound to this canonical wallet is required.");
}

function validateAuthority(authority: ExecutedAgentTradeAuthority, order: AgentVenueOrderV2, proposalPda: string, now: number): void {
  if (!authority.finalized || authority.chainGenesisHash !== order.chainGenesisHash ||
    authority.ownerProgramId !== order.programId || authority.walletPda !== order.walletPda ||
    authority.proposalPda !== proposalPda || authority.actionKind !== 9 || authority.clearSignVersion !== 4 ||
    authority.status !== "executed" || !Number.isSafeInteger(authority.threshold) || authority.threshold < 1 ||
    !Number.isSafeInteger(authority.approvals) || authority.approvals < authority.threshold) {
    throw new Error("Finalized threshold-executed typed trade authority is required.");
  }
  const expected = {
    actionId: order.actionId, agentIdHash: order.agentIdHash, sessionIdHash: order.sessionIdHash,
    venueHash: hashText(order.venue), marketHash: hashText(order.market), sideHash: hashText(order.side),
    assetIdHash: hashText(`USDC:${order.venue}`), notionalUsdRaw: order.notionalUsdRaw,
    leverageX100: order.leverageX100, route: agentVenueOrderRoute(order),
    policyCommitment: order.policyCommitment, riskCheckHash: order.riskCheckHash, expiresAtMs: order.expiresAtMs,
  };
  if (Object.entries(expected).some(([key, value]) => authority.canonical[key as keyof typeof expected] !== value)) {
    throw new Error("Venue order differs from the exact threshold-approved canonical action.");
  }
  const session = authority.session;
  if (!session.active || session.walletPda !== order.walletPda || session.sessionIdHash !== order.sessionIdHash ||
    session.agentIdHash !== order.agentIdHash || session.policyCommitment !== order.policyCommitment ||
    session.venueHash !== expected.venueHash || (session.marketHash !== "0".repeat(64) && session.marketHash !== expected.marketHash) ||
    !Number.isSafeInteger(session.expiresAtMs) || session.expiresAtMs <= now || order.expiresAtMs <= now ||
    !Number.isSafeInteger(session.maxLeverageX100) || session.maxLeverageX100 < order.leverageX100 ||
    nonnegativeRaw(session.spentNotionalRaw) > positiveRaw(session.maxNotionalRaw) ||
    nonnegativeRaw(session.spentNotionalRaw) < positiveRaw(order.notionalUsdRaw)) throw new Error("The on-chain trading grant is inactive, expired, mismatched or over budget.");
  const risk = authority.risk;
  if (!risk.active || risk.walletPda !== order.walletPda || risk.sessionIdHash !== order.sessionIdHash ||
    nonnegativeRaw(risk.realizedLossRaw) >= positiveRaw(risk.maxLossRaw) ||
    nonnegativeRaw(risk.openNotionalRaw) < positiveRaw(order.notionalUsdRaw) ||
    nonnegativeRaw(risk.openNotionalRaw) > positiveRaw(session.maxNotionalRaw)) throw new Error("The on-chain risk ledger does not authorize this reserved exposure.");
  const limits = authority.limits;
  if (limits.policyCommitment !== order.policyCommitment || !Number.isSafeInteger(limits.maxOpenPositions) ||
    limits.maxOpenPositions < 1 || !Number.isSafeInteger(limits.cooldownMs) || limits.cooldownMs < 0 ||
    typeof limits.requireTakeProfit !== "boolean" || (limits.requireTakeProfit && order.takeProfitPrice === null)) throw new Error("The authoritative risk/protection policy is incomplete.");
  positiveRaw(limits.dailyLossCapRaw);
}

function validateObservedRisk(observed: ObservedVenueRisk, authority: ExecutedAgentTradeAuthority, order: AgentVenueOrderV2, now: number): void {
  const stopDirection = compareExactPrices(order.stopLossPrice, observed.markPrice);
  const takeProfitDirection = order.takeProfitPrice === null ? null : compareExactPrices(order.takeProfitPrice, observed.markPrice);
  if (observed.accountAddress !== order.accountAddress || !observed.reconciled || observed.hasUnknownOrders ||
    !Number.isSafeInteger(observed.observedAtMs) || observed.observedAtMs > now || now - observed.observedAtMs > MAX_RISK_AGE_MS ||
    !Number.isSafeInteger(observed.openPositionCount) || observed.openPositionCount < 0 ||
    !Number.isSafeInteger(observed.pendingReservationCount) || observed.pendingReservationCount < 0 ||
    observed.openPositionCount + observed.pendingReservationCount >= authority.limits.maxOpenPositions ||
    (observed.lastEntryAtMs !== null && (!Number.isSafeInteger(observed.lastEntryAtMs) ||
      observed.lastEntryAtMs > now || now - observed.lastEntryAtMs < authority.limits.cooldownMs)) ||
    nonnegativeRaw(observed.dailyRealizedLossRaw) >= positiveRaw(authority.limits.dailyLossCapRaw) ||
    (order.side === "long" ? stopDirection >= 0 : stopDirection <= 0) ||
    (takeProfitDirection !== null && (order.side === "long" ? takeProfitDirection <= 0 : takeProfitDirection >= 0))) {
    throw new Error("Current venue risk is stale, unknown, or outside the approved limits.");
  }
}

function validateReceipt(receipt: ProtectedVenueReceipt, order: AgentVenueOrderV2, proposalPda: string, deliveryKey: string, commitment: string): void {
  if (receipt.deliveryKey !== deliveryKey || receipt.commitment !== commitment || receipt.walletPda !== order.walletPda ||
    receipt.proposalPda !== proposalPda || receipt.accountAddress !== order.accountAddress || !receipt.entryOrderId ||
    !receipt.stopLossOrderId || !receipt.protectionVerified ||
    (order.takeProfitPrice !== null && !receipt.takeProfitOrderId) ||
    !Number.isSafeInteger(receipt.observedAtMs) || receipt.observedAtMs <= 0) {
    throw new Error("Venue receipt does not independently verify the exact order and its protection.");
  }
}
