import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import { fetchOnchainMemberships, parseMembershipResponse } from "../client";
import { listMemberships } from "@/lib/chain/memberships";
import { backendApi } from "@/lib/api/endpoints";
vi.mock("@/lib/chain/memberships", () => ({ listMemberships: vi.fn() }));
vi.mock("@/lib/api/endpoints", () => ({ backendApi: { memberships: vi.fn() } }));
vi.mock("@/lib/chain/client", () => ({ getConnection: vi.fn(() => connection) }));
const connection = new Connection("https://rpc.fixture.invalid");
const address = "11111111111111111111111111111111";
const member = { wallet: address, wallet_name: "Team", wallet_creator: address, roles: ["approver"], intent_indexes: [0] };
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe("membership response validation", () => {
  it("accepts verified empty and complete memberships", () => {
    expect(parseMembershipResponse({ organizations: [] })).toEqual([]);
    expect(parseMembershipResponse({ organizations: [member] })).toEqual([member]);
  });
  it("normalizes optional legacy null fields", () => {
    expect(parseMembershipResponse({ organizations: [{ ...member, wallet_name: null, wallet_creator: null }] })[0]).toMatchObject({ wallet_name: undefined, wallet_creator: undefined });
  });
  it.each([null, undefined, {}, [], { organizations: null }, { organizations: {} }, { organizations: [null] },
    ...[{ wallet: "bad" }, { wallet_name: 12 }, { wallet_name: " " }, { wallet_creator: "bad" }, { roles: [] }, { roles: ["admin"] }, { roles: null }, { intent_indexes: [256] }, { intent_indexes: [-1] }, { intent_indexes: [0.5] }, { intent_indexes: ["0"] }].map(value => ({ organizations: [member, { ...member, ...value }] })),
  ])("rejects malformed or partially malformed responses instead of an empty/partial result: %j", value => {
    expect(() => parseMembershipResponse(value)).toThrow("invalid response");
  });
});
describe("membership discovery", () => {
  it("uses the provided connection and trusts successful empty RPC reads", async () => {
    vi.mocked(listMemberships).mockResolvedValue([]);
    expect(await fetchOnchainMemberships(address, { connection })).toEqual([]);
    expect(listMemberships).toHaveBeenCalledWith(connection, address);
    expect(backendApi.memberships).not.toHaveBeenCalled();
  });
  it("falls back after RPC failure and preserves valid results", async () => {
    vi.mocked(listMemberships).mockRejectedValue(new Error("offline"));
    vi.mocked(backendApi.memberships).mockResolvedValue({ organizations: [member] });
    expect(await fetchOnchainMemberships(address)).toEqual([member]);
  });
  it("propagates backend failure and malformed fallback", async () => {
    vi.mocked(listMemberships).mockRejectedValue(new Error("offline"));
    vi.mocked(backendApi.memberships).mockRejectedValue(new Error("backend offline"));
    await expect(fetchOnchainMemberships(address)).rejects.toThrow("backend offline");
    vi.mocked(backendApi.memberships).mockResolvedValue({});
    await expect(fetchOnchainMemberships(address)).rejects.toThrow("invalid response");
  });
  it("bounds a stuck RPC read before using fallback", async () => {
    vi.useFakeTimers();
    vi.mocked(listMemberships).mockReturnValue(new Promise(() => {}));
    vi.mocked(backendApi.memberships).mockResolvedValue({ organizations: [member] });
    const read = fetchOnchainMemberships(address);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await read).toEqual([member]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels an old account/network read without invoking fallback", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(listMemberships).mockReturnValue(new Promise(() => {}));
    const read = fetchOnchainMemberships(address, { signal: controller.signal });
    const rejection = expect(read).rejects.toThrow("changed");
    controller.abort(new Error("changed"));
    await rejection;
    expect(backendApi.memberships).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start an already cancelled read", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchOnchainMemberships(address, { signal: controller.signal })).rejects.toThrow();
    expect(listMemberships).not.toHaveBeenCalled();
  });
  it("passes cancellation through to backend and discards a late response", async () => {
    const controller = new AbortController();
    vi.mocked(backendApi.memberships).mockImplementation(async () => { controller.abort(new Error("changed")); return { organizations: [member] }; });
    await expect(fetchOnchainMemberships(address, { preferBackend: true, signal: controller.signal })).rejects.toThrow("changed");
    expect(backendApi.memberships).toHaveBeenCalledWith(address, { signal: controller.signal, timeoutMs: 12_000 });
  });
});
