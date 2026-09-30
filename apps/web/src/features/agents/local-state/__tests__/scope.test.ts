import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { activateAgentLocalStateScope, clearAgentLocalStateScope, currentAgentLocalStateScopeId,
  readScopedAgentStorage, writeScopedAgentStorage } from "../scope";
import { readAgentState, writeAgentState } from "../repository";
import { recoverLegacyAgentProfiles } from "../legacyRecovery";

const pda = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value) }, dispatchEvent: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn() });
  clearAgentLocalStateScope();
});
afterEach(() => { clearAgentLocalStateScope(); vi.unstubAllGlobals(); });
const activate = (subject = "alice", walletPda = pda(1)) => activateAgentLocalStateScope({ sessionSubject: subject, walletPda, chainNamespace: pda(9) });

describe("agent local identity isolation", () => {
  it("reads no private state and refuses writes while identity is unresolved", () => {
    storage.set("clear.agents.v1", JSON.stringify({ version: 1, agentsByWallet: { vault: [{ name: "Private" }] } }));
    const locked = readAgentState();
    expect(locked.agentsByWallet).toEqual({});
    expect(() => writeAgentState(locked)).toThrow("account changed");
    expect(storage.size).toBe(1);
  });

  it("isolates accounts and same-named wallets by canonical PDA", () => {
    activate();
    writeScopedAgentStorage("clear.agents.v1", "alice-wallet-one");
    activate("bob");
    expect(readScopedAgentStorage("clear.agents.v1")).toBeNull();
    activate("alice", pda(2));
    expect(readScopedAgentStorage("clear.agents.v1")).toBeNull();
    activate();
    expect(readScopedAgentStorage("clear.agents.v1")).toBe("alice-wallet-one");
  });

  it("does not let an old async snapshot write into the new account", () => {
    activate();
    const old = readAgentState();
    activate("bob");
    expect(() => writeAgentState(old)).toThrow("account changed");
    expect(readAgentState().agentsByWallet).toEqual({});
  });

  it("does not let stale boundary cleanup clear a new account", () => {
    const releaseAlice = activate();
    activate("bob");
    const bob = currentAgentLocalStateScopeId();
    releaseAlice();
    expect(currentAgentLocalStateScopeId()).toBe(bob);
    clearAgentLocalStateScope();
    expect(currentAgentLocalStateScopeId()).toBeNull();
  });

  it("rejects snapshots from an earlier login even when the same account returns", () => {
    activate();
    const old = readAgentState();
    clearAgentLocalStateScope();
    activate();
    expect(() => writeAgentState(old)).toThrow("account changed");
  });

  it("never automatically assigns legacy keys, approvals or grants to a new account", () => {
    const legacy = JSON.stringify({ version: 1,
      agentsByWallet: { vault: [{ id: "old", walletName: "vault", name: "Old trader", status: "active", kind: "custom" }] },
      connectionsByWallet: { vault: { old: { managementKey: "old-private-connection" } } },
      sessionsByWallet: { vault: [{ status: "active" }] }, approvalsByWallet: { vault: [{ signature: "old" }] },
    });
    storage.set("clear.agents.v1", legacy);
    activate();
    expect(readAgentState().agentsByWallet).toEqual({});
    const expectedScopeId = currentAgentLocalStateScopeId()!;
    expect(() => recoverLegacyAgentProfiles({ walletName: "vault", expectedScopeId, confirmedOwnership: false })).toThrow("Confirm ownership");
    expect(recoverLegacyAgentProfiles({ walletName: "vault", expectedScopeId, confirmedOwnership: true })).toBe(1);
    const state = readAgentState();
    expect(state.agentsByWallet.vault[0]).toMatchObject({ name: "Old trader", status: "paused", kind: "mock" });
    expect(state.connectionsByWallet).toEqual({});
    expect(state.sessionsByWallet).toEqual({});
    expect(state.approvalsByWallet).toEqual({});
    expect(storage.get("clear.agents.v1")).toBe(legacy);
  });
});
