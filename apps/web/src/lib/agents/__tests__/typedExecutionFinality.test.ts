import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { hashAgentText } from "@/lib/agents/agentClearSignEncoding";
const mocks = vi.hoisted(() => ({
  kind: 12,
  finalized: false,
  submitted: false,
  altered: "",
  response: {} as Record<string, unknown>,
  execute: vi.fn(),
  read: vi.fn(),
}));
const address = "11111111111111111111111111111111";
function executor() {
  return {
    sessionIdHash: hashAgentText("session"),
    agentIdHash: hashAgentText("agent"),
    venueHash: hashAgentText("hyperliquid"),
    marketHash: hashAgentText("BTC"),
    amountRaw: "5000000",
    maxNotionalRaw: "5000000",
    maxLeverageX100: 200,
    expiresAt: 1900000000,
    status: 1,
    sideHash: hashAgentText("long"),
    assetIdHash: hashAgentText("BTC"),
    routeHash: hashAgentText("route"),
    riskCheckHash: "f".repeat(64),
    maxLossRaw: "1000000",
    oraclePolicyHash: "f".repeat(64),
    executionIdHash: hashAgentText("execution"),
    closedNotionalRaw: "5000000",
    pnlAbsRaw: "0",
    settlementSequence: 1,
    settlementArtifactHash: "f".repeat(64),
    outcome: 3,
  };
}
function document(kind: number) {
  const title =
    kind === 9
      ? "Approve agent trade"
      : kind === 12
        ? "Grant agent session"
        : kind === 13
          ? "Set agent risk policy"
          : "Settle agent execution";
  return `ClearSig Approval\n\nACTION\n${title}\n\nDETAILS\nSession: session\nAgent: agent\nVenue: hyperliquid\nMarket: BTC\nMaximum notional: 5 USD\nMaximum leverage: 2x\nSession expiry (Unix): 1900000000\nSide: long\nAsset ID: BTC\nRoute: route\nRisk check: ${"f".repeat(64)}\nMaximum realized loss (raw): 1000000\nOracle policy: ${"f".repeat(64)}\nExecution: execution\nClosed notional (raw): 5000000\nAbsolute P/L (raw): 0\nSettlement sequence: 1\nSettlement artifact: ${"f".repeat(64)}\nOutcome: flat`.replace(
    mocks.altered || "__unchanged__",
    "MISMATCHED",
  );
}
const binding = (kind: number) => ({
  actionKindCode: kind,
  envelopeHash: "a".repeat(64),
  payloadHash: "b".repeat(64),
  signableText: document(kind),
});
const envelope = {
  kind: "agent_session_grant",
  walletName: "Fixture",
  walletId: address,
  policyCommitment: "f".repeat(64),
  payload: { status: "active" },
};
vi.mock("react", () => ({ useCallback: (value: unknown) => value }));
vi.mock("@/lib/hooks/useRequestIdentity", () => ({
  useRequestIdentity: () => ({
    capture: () => ({ accountKey: "c".repeat(64), assertCurrent: () => {} }),
  }),
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "fixture" } }),
  useWallet: () => ({
    pickSigner: () => new PublicKey("11111111111111111111111111111111"),
  }),
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({ signTypedDescriptor: vi.fn() }),
}));
vi.mock("@/lib/chain/wallets", () => ({
  fetchWalletByName: async () => ({
    pda: new PublicKey("11111111111111111111111111111111"),
    account: { intentIndex: 0 },
  }),
}));
vi.mock("@/lib/chain/intents", () => ({
  listIntents: async () => [
    {
      account: {
        approved: true,
        intentType: 3,
        chainKind: 5,
        proposers: ["11111111111111111111111111111111"],
        approvers: ["11111111111111111111111111111111"],
      },
    },
  ],
}));
vi.mock("@/lib/agents/sessionClearSign", () => ({
  buildAgentSessionClearSign: () => ({ envelope, executor: executor() }),
}));
vi.mock("@/lib/agents/riskPolicyClearSign", () => ({
  buildAgentRiskPolicyClearSign: () => ({ envelope, executor: executor() }),
}));
vi.mock("@/lib/agents/settlementClearSign", () => ({
  buildAgentSettlementClearSign: () => ({ envelope, executor: executor() }),
}));
vi.mock("@/lib/agents/agentRiskLedger", () => ({
  fetchAgentRiskLedger: async () => ({}),
}));
vi.mock("@/lib/agents/clearsign", () => ({
  buildAgentTradeClearSign: () => ({
    ...envelope,
    actionId: "fixture",
    nonce: "fixture",
    expiresAt: 1900000000,
    executor: executor(),
  }),
}));
vi.mock("@/features/agents/local-state/store", () => ({
  listAgentSessions: () => [
    {
      id: "session",
      agentId: "agent",
      status: "active",
      onchain: { status: "executed" },
      expiresAt: Date.now() + 100000,
    },
  ],
}));
vi.mock("@/lib/clearsign/readProposalReview", () => ({
  readCanonicalProposalReview: mocks.read,
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    executeTypedAgentSessionGrant: mocks.execute,
    executeTypedAgentRiskPolicy: mocks.execute,
    executeTypedAgentTradeApproval: mocks.execute,
    executeTypedAgentTradeSettlement: mocks.execute,
  },
}));
import { useAgentTypedSessionGrant as createSessionFixture } from "../useAgentTypedSessionGrant";
import { useAgentTypedRiskPolicy as createRiskFixture } from "../useAgentTypedRiskPolicy";
import { useAgentTypedClearSignApproval as createTradeFixture } from "../useAgentTypedClearSignApproval";
import { useAgentTypedTradeSettlement as createSettlementFixture } from "../useAgentTypedTradeSettlement";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
const paths: Record<number, string> = {
  9: "typed_agent_trade_approval",
  12: "typed_agent_session_grant",
  13: "typed_agent_risk_policy",
  14: "typed_agent_trade_settlement",
};
async function invoke(kind: number) {
  const pending = {
    proposalAddress: address,
    proposalIndex: 0,
    intentIndex: 0,
    status: "approved",
    operation: "active",
    policyHash: "f".repeat(64),
    executionBinding: binding(kind),
  };
  const session = {
    id: "session",
    agentId: "agent",
    status: "active",
    onchain: { ...pending, status: kind === 12 ? "approved" : "executed" },
    riskOnchain: { ...pending, status: kind === 14 ? "executed" : "approved" },
  };
  if (kind === 12)
    return (
      await createSessionFixture("Fixture")(session as never, {
        venue: "hyperliquid",
        market: "BTC",
        status: "active",
      })
    ).onchain?.status;
  if (kind === 13)
    return (
      await createRiskFixture("Fixture")(
        session as never,
        { policyHash: "f".repeat(64) } as never,
      )
    ).riskOnchain?.status;
  if (kind === 9)
    return (
      await createTradeFixture("Fixture")({
        sessionId: "session",
        agentId: "agent",
        clearSignV2: { onchainProposal: pending },
      } as never)
    ).status;
  return (
    await createSettlementFixture("Fixture")({
      session: session as never,
      policyHash: "f".repeat(64),
      settlement: {
        requestId: "execution",
        settlementArtifactHash: "f".repeat(64),
      } as never,
      pending,
    } as never)
  ).status;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.altered = "";
  mocks.finalized = false;
  mocks.submitted = false;
  requestRecovery.resolveExecution("fixture", address);
  mocks.execute.mockImplementation(async () => {
    mocks.submitted = true;
    return mocks.response;
  });
  mocks.read.mockImplementation(async () => ({
    status: mocks.finalized && mocks.submitted ? 2 : 1,
    binding: { actionKind: mocks.kind, wallet: address },
    envelopeHash: binding(mocks.kind).envelopeHash,
    payloadHash: binding(mocks.kind).payloadHash,
    document: binding(mocks.kind).signableText,
  }));
});
describe("actual agent hook execution paths; framework/provider boundaries synthetic", () => {
  for (const kind of [9, 12, 13, 14]) {
    it(`kind${kind}: finalized same-kind record for another session cannot satisfy current request`, async () => {
      mocks.kind = kind;
      mocks.finalized = true;
      mocks.submitted = true;
      mocks.altered = "Session: session";
      await expect(invoke(kind)).rejects.toThrow(/Canonical/);
      expect(mocks.execute).not.toHaveBeenCalled();
    });

    it(`kind${kind}: empty response cannot mark executed and second call cannot replay`, async () => {
      mocks.kind = kind;
      mocks.response = {};
      expect(await invoke(kind)).toBe("approved");
      expect(await invoke(kind)).toBe("approved");
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.execute.mock.calls[0].at(-1)).toEqual({ retry: false });
    });
    it(`kind${kind}: a valid txid is pending, not execution`, async () => {
      mocks.kind = kind;
      mocks.response = {
        txid: bs58.encode(new Uint8Array(64).fill(7)),
        proposal: address,
        path: paths[kind],
      };
      expect(await invoke(kind)).toBe("approved");
      expect(requestRecovery.executionFor("fixture", address)?.outcome).toBe(
        "submitted",
      );
    });
    it(`kind${kind}: only exact finalized execution marks executed`, async () => {
      mocks.kind = kind;
      mocks.finalized = true;
      mocks.response = {
        txid: bs58.encode(new Uint8Array(64).fill(7)),
        proposal: address,
        path: paths[kind],
      };
      expect(await invoke(kind)).toBe("executed");
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(requestRecovery.executionFor("fixture", address)).toBeUndefined();
    });
  }
});
