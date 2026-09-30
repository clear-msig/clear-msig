import { AGENT_TEST_GENESIS_HASH, agentTestDeploymentIdentity } from "@/test/agents/walletScope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), genesis: vi.fn(), wallet: vi.fn(), account: vi.fn(), intent: vi.fn(), state: vi.fn(), save: vi.fn(), autonomy: vi.fn(), approval: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/dynamicAuth", async (original) => ({ ...await original<object>(), authenticateNotificationRequest: mocks.identity }));
vi.mock("@/lib/chain/wallets", () => ({ fetchWalletByName: mocks.wallet }));
vi.mock("@/lib/chain/client", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return { CLEAR_WALLET_PROGRAM_ID: new PublicKey("11111111111111111111111111111111"), DEFAULT_COMMITMENT: "confirmed", getConnection: () => ({ getAccountInfo: mocks.account, getGenesisHash: mocks.genesis }) };
});
vi.mock("@/lib/msig", async (original) => ({ ...await original<object>(), parseIntent: mocks.intent }));
vi.mock("@/features/agents/server/serverState", async (original) => ({
  ...await original<object>(), getAgentServerWalletState: mocks.state,
  agentServerLeaderboard: vi.fn(async () => []), saveAgentServerProfile: mocks.save, saveAgentServerOwnerApproval: mocks.approval,
}));
vi.mock("@/lib/agents/serverAutonomousTrading", () => ({ runAgentAutonomyTick: mocks.autonomy }));

import { authenticateWalletMember, withWalletMember } from "@/lib/auth/walletAuthorization";
import { NotificationAuthError } from "@/lib/notifications/dynamicAuth";
import { findWalletAddress } from "@/lib/msig";
import { GET as getState, POST as postState } from "@/app/api/agent-state/[name]/route";
import { POST as tick } from "@/app/api/agent-autonomy/[name]/tick/route";
import { GET as getSignals, POST as postSignals, DELETE as deleteSignals } from "@/app/api/agent-signals/[name]/[agent]/route";
import { GET as getExecution, POST as postExecution } from "@/app/api/agent-execution/[venue]/route";
import { POST as postSettlement, PATCH as patchSettlement } from "@/app/api/agent-settlement/[venue]/route";
import { withAgentWalletStorageScope } from "@/features/agents/server/walletScope";
import { registerAgentSignalKey, listAgentInboxSignals, removeAgentInboxSignals } from "@/lib/agents/serverInbox";
import { signAgentSignalPayload } from "@/lib/agents/signalSignature";

const program = new PublicKey("11111111111111111111111111111111");
const member = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58();
const other = Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey.toBase58();
const walletName = "member-vault";
const walletAddress = findWalletAddress(walletName, new PublicKey(member), program)[0].toBase58();
const ctx = { params: Promise.resolve({ name: walletName }) };
const signalsCtx = { params: Promise.resolve({ name: walletName, agent: "alpha" }) };
const venueCtx = { params: Promise.resolve({ venue: "hyperliquid_testnet" }) };
const target = () => ({ ...agentTestDeploymentIdentity(), walletAddress, agentId: "alpha" });
const scope = <T>(run: () => Promise<T>) => withAgentWalletStorageScope({ walletName, walletAddress, chainGenesisHash: AGENT_TEST_GENESIS_HASH }, run);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.genesis.mockResolvedValue(AGENT_TEST_GENESIS_HASH);
  mocks.identity.mockResolvedValue({ userId: "verified-subject", verifiedSolanaWallets: [member], verifiedEmails: [] });
  mocks.wallet.mockResolvedValue({ name: walletName, pda: new PublicKey(walletAddress), account: { name: walletName, creator: member } });
  mocks.account.mockResolvedValue({ owner: program, data: new Uint8Array() });
  mocks.intent.mockReturnValue({ wallet: walletAddress, intentIndex: 0, approved: true, proposers: [member], approvers: [] });
  mocks.state.mockResolvedValue({ walletName, agents: [], proposals: [], executions: [] });
  mocks.save.mockImplementation(async (agent) => agent);
});

afterEach(() => { vi.unstubAllEnvs(); });

function request(path: string, method = "GET", body?: unknown, token = "session") {
  return new NextRequest(`http://localhost/api/${path}`, {
    method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("fresh authenticated governance membership", () => {
  it("rejects a forged Origin and claimed approvedBy before chain reads or persistence", async () => {
    const response = await postState(request(`agent-state/${walletName}`, "POST", { action: "upsert_agent", payload: { walletName, id: "a", name: "A", approvedBy: member } }, ""), ctx);
    expect(response.status).toBe(401);
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects an invalid signed session before chain reads", async () => {
    mocks.identity.mockRejectedValue(new NotificationAuthError("Invalid session signature."));
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(401);
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("accepts current proposer and approver roles, without claiming trade authority", async () => {
    expect((await authenticateWalletMember(request("agent-state/x"), walletName)).memberWallets).toEqual([member]);
    mocks.intent.mockReturnValue({ wallet: walletAddress, intentIndex: 0, approved: true, proposers: [], approvers: [member] });
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(200);
  });
  it("rejects a session that verifies an unrelated wallet", async () => {
    mocks.identity.mockResolvedValue({ userId: "other-subject", verifiedSolanaWallets: [other], verifiedEmails: [] });
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(403);
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("rechecks chain membership after revocation instead of trusting the previous request", async () => {
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(200);
    mocks.intent.mockReturnValue({ wallet: walletAddress, intentIndex: 0, approved: true, proposers: [], approvers: [] });
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(403);
    expect(mocks.account).toHaveBeenCalledTimes(2);
    expect(mocks.state).toHaveBeenCalledTimes(1);
  });
  it.each([
    { approved: false }, { wallet: other }, { intentIndex: 1 },
  ])("rejects an unapproved or wrong governance account %j", async (change) => {
    mocks.intent.mockReturnValue({ wallet: walletAddress, intentIndex: 0, approved: true, proposers: [member], approvers: [], ...change });
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(403);
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("rejects program ownership substitution", async () => {
    mocks.account.mockResolvedValue({ owner: new PublicKey(other), data: new Uint8Array() });
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(403);
    expect(mocks.intent).not.toHaveBeenCalled();
  });
  it("fails closed on missing wallets, name collisions, RPC failures, and noncanonical PDAs", async () => {
    mocks.wallet.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Ambiguous wallet name")).mockRejectedValueOnce(new Error("RPC unavailable")).mockResolvedValueOnce({ pda: new PublicKey(other), account: { name: walletName, creator: member } });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await getState(request(`agent-state/${walletName}`), ctx)).status);
    expect(statuses).toEqual([403, 503, 503, 403]);
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("does not let an authorized member label another external signer as an owner", async () => {
    const response = await postState(request(`agent-state/${walletName}`, "POST", {
      action: "record_owner_approval", payload: { walletName, id: "approval", action: "grant_allowance", summary: "Grant", approvalHash: "hash", approvedBy: other, signature: "forged" },
    }), ctx);
    expect(response.status).toBe(403);
    expect(mocks.approval).not.toHaveBeenCalled();
  });
  it("fails closed when discovered genesis differs from the deployment pin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", other);
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(503);
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("fails closed when genesis cannot be discovered", async () => {
    mocks.genesis.mockRejectedValue(new Error("RPC unavailable"));
    expect((await getState(request(`agent-state/${walletName}`), ctx)).status).toBe(503);
    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("returns noncacheable private responses", async () => {
    const response = await withWalletMember(request("agent-state/x"), walletName, async () => (await import("next/server")).NextResponse.json({ ok: true }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("private route boundaries", () => {
  it("gates inbox read/register/import/delete and autonomy before side effects", async () => {
    const missing = (method: string, body?: unknown) => request(`agent-signals/${walletName}/alpha`, method, body, "");
    expect((await getSignals(missing("GET"), signalsCtx)).status).toBe(401);
    expect((await postSignals(missing("POST", { action: "register", signalKey: "key", managementKey: "mgmt" }), signalsCtx)).status).toBe(401);
    expect((await postSignals(missing("POST", { action: "import", ids: ["id"] }), signalsCtx)).status).toBe(401);
    expect((await deleteSignals(missing("DELETE", { ids: ["id"] }), signalsCtx)).status).toBe(401);
    expect((await tick(request(`agent-autonomy/${walletName}/tick`, "POST", {}, ""), ctx)).status).toBe(401);
    expect(mocks.autonomy).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
  });
  it("gates private execution history, requests and settlement metadata", async () => {
    expect((await getExecution(request(`agent-execution/hyperliquid_testnet?walletName=${walletName}&agentId=alpha`, "GET", undefined, ""), venueCtx)).status).toBe(401);
    expect((await postExecution(request("agent-execution/hyperliquid_testnet", "POST", { walletName, agentId: "alpha", proposalId: "p", venue: "hyperliquid_testnet", market: "BTC-PERP", side: "long", orderType: "market", notionalUsd: "1", leverage: 1, approvedAt: Date.now() }, ""), venueCtx)).status).toBe(401);
    expect((await postSettlement(request("agent-settlement/hyperliquid_testnet", "POST", { walletName, agentId: "alpha", requestId: "r" }, ""), venueCtx)).status).toBe(401);
    expect((await patchSettlement(request("agent-settlement/hyperliquid_testnet", "PATCH", { walletName, agentId: "alpha", requestId: "r", proposalAddress: member, status: "created" }, ""), venueCtx)).status).toBe(401);
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it("keeps bare readiness public without exposing configured account or executor details", async () => {
    const response = await getExecution(request("agent-execution/hyperliquid_testnet", "GET", undefined, ""), venueCtx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountSnapshot: null, accountProbe: null, executorProbe: null, requests: [] });
    expect(mocks.identity).not.toHaveBeenCalled();
  });
});

describe("target-bound external signed signal ingress", () => {
  it("requires v2 HMAC and preserves bearer-free scoped ingestion with replay protection", async () => {
    await scope(() => registerAgentSignalKey({ walletName, agentId: "alpha", signalKey: "shared-key", managementKey: "owner-key" }));
    const signal = { clientSignalId: "nonce-membership-test", submittedAt: Date.now(), venue: "mock_perps" as const, market: "BTC-PERP", side: "long" as const, notionalUsd: "1", leverage: 1 };
    const submit = (signature?: string, scheme = "hmac_sha256_v2") => postSignals(request(`agent-signals/${walletName}/alpha`, "POST", { signal, signalKey: "shared-key", signature, signatureScheme: scheme }, ""), signalsCtx);
    expect((await submit()).status).toBe(401);
    const signature = signAgentSignalPayload({ signal, signalKey: "shared-key", target: target() });
    expect((await submit(signature, "hmac_sha256_v1")).status).toBe(401);
    const wrongTarget = signAgentSignalPayload({ signal, signalKey: "shared-key", target: { ...target(), agentId: "other-agent" } });
    expect((await submit(wrongTarget)).status).toBe(401);
    const accepted = await submit(signature);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ duplicate: false, verification: { scheme: "hmac_sha256_v2" } });
    const items = await scope(() => listAgentInboxSignals(walletName, "alpha"));
    await scope(() => removeAgentInboxSignals(walletName, "alpha", items.map((item) => item.id)));
    expect(await (await submit(signature)).json()).toMatchObject({ duplicate: true });
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it("rejects stale/future signed signals before persistence", async () => {
    await scope(() => registerAgentSignalKey({ walletName, agentId: "alpha", signalKey: "shared-key", managementKey: "owner-key" }));
    for (const submittedAt of [Date.now() - 11 * 60_000, Date.now() + 3 * 60_000]) {
      const signal = { clientSignalId: `nonce-${submittedAt}`, submittedAt, venue: "mock_perps" as const, market: "BTC-PERP", side: "long" as const, notionalUsd: "1", leverage: 1 };
      const signature = signAgentSignalPayload({ signal, signalKey: "shared-key", target: target() });
      const response = await postSignals(request(`agent-signals/${walletName}/alpha`, "POST", { signal, signalKey: "shared-key", signature, signatureScheme: "hmac_sha256_v2" }, ""), signalsCtx);
      expect(response.status).toBe(400);
    }
    expect(await scope(() => listAgentInboxSignals(walletName, "alpha"))).toEqual([]);
  });
  it("bounds the body before parsing or resolving external signal wallet identity", async () => {
    const req = new NextRequest(`http://localhost/api/agent-signals/${walletName}/alpha`, { method: "POST", body: "x".repeat(8_001) });
    expect((await postSignals(req, signalsCtx)).status).toBe(413);
    expect(mocks.wallet).not.toHaveBeenCalled();
  });
});
