import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { withAgentWalletStorageScope, agentWalletStorageKey } from "./walletScope";
import { getAgentServerWalletState, saveAgentServerProfile } from "./serverState";
import { registerAgentSignalKey, verifyAgentSignalKey } from "@/lib/agents/serverInbox";

const address = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
const scoped = <T>(walletAddress: string, walletName: string, operation: () => Promise<T>) =>
  withAgentWalletStorageScope({ walletAddress, walletName, chainGenesisHash: address(9) }, operation);
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("canonical server agent storage namespaces", () => {
  it("fails closed without a verified canonical context or across a mismatched name", async () => {
    await expect(getAgentServerWalletState("scope-locked")).rejects.toThrow("canonical wallet scope");
    await expect(scoped(address(1), "scope-a", () => getAgentServerWalletState("scope-b"))).rejects.toThrow("canonical wallet scope");
  });

  it("isolates same-named wallets by canonical PDA", async () => {
    const walletName = "scope-shared-name";
    await scoped(address(1), walletName, () => saveAgentServerProfile({ id: "agent", walletName,
      name: "Wallet one", kind: "mock", status: "paused", createdAt: 1, updatedAt: 1, version: 1 }));
    const other = await scoped(address(2), walletName, () => getAgentServerWalletState(walletName));
    expect(other.agents).toEqual([]);
    const original = await scoped(address(1), walletName, () => getAgentServerWalletState(walletName));
    expect(original.agents[0]?.name).toBe("Wallet one");
  });

  it("does not collide colon-separated wallet and agent identities", async () => {
    await scoped(address(3), "a:b", () => registerAgentSignalKey({ walletName: "a:b", agentId: "c",
      signalKey: "private-one", managementKey: "manager-one" }));
    expect(await scoped(address(4), "a", () => verifyAgentSignalKey({ walletName: "a", agentId: "b:c",
      signalKey: "private-one" }))).toBe(false);
  });

  it("uses v2 Redis keys without reading or overwriting legacy name-only data", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://store.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    const commands: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      commands.push(JSON.parse(String(init?.body))[0]);
      return new Response(JSON.stringify([{ result: null }]), { status: 200 });
    }));
    await scoped(address(5), "scope-legacy", () => getAgentServerWalletState("scope-legacy"));
    expect(commands).toHaveLength(1);
    expect(commands[0][0]).toBe("GET");
    expect(commands[0][1]).toMatch(/^agent:v2:state:[a-f0-9]{64}$/);
  });

  it("preserves independent contexts across concurrent async requests", async () => {
    const keys = await Promise.all([1, 2].map((id) => scoped(address(id), "scope-parallel", async () => {
      await Promise.resolve();
      return agentWalletStorageKey("scope-parallel", "inbox", ["agent"]);
    })));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keeps identity across provider rotation and separates different genesis chains", async () => {
    const readKey = () => agentWalletStorageKey("scope-provider", "state");
    const first = await scoped(address(1), "scope-provider", async () => readKey());
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_URL", "https://new-provider.test/key-changed");
    expect(await scoped(address(1), "scope-provider", async () => readKey())).toBe(first);
    const otherChain = await withAgentWalletStorageScope({ walletAddress: address(1),
      walletName: "scope-provider", chainGenesisHash: address(8) }, async () => readKey());
    expect(otherChain).not.toBe(first);
  });
});
