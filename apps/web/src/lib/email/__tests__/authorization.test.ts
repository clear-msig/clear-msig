import { describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
const mocks = vi.hoisted(() => ({ wallet: vi.fn(), account: vi.fn(), policy: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/chain/wallets", () => ({ fetchWalletByName: mocks.wallet }));
vi.mock("@/lib/chain/client", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return { CLEAR_WALLET_PROGRAM_ID: new PublicKey("11111111111111111111111111111111"), DEFAULT_COMMITMENT: "confirmed", getConnection: () => ({ getAccountInfo: mocks.account }) };
});
vi.mock("@/lib/msig", async (original) => ({ ...await original<object>(), parseIntent: mocks.policy }));
import { requireInvitationAuthority, requireVerifiedNotificationEmail } from "../authorization";
const address = "11111111111111111111111111111111";
const identity = { userId: "subject", verifiedSolanaWallets: [address], verifiedEmails: ["verified@example.test"] };
describe("email authorization", () => {
  it("restricts self-notifications to a signed verified email credential", () => {
    expect(() => requireVerifiedNotificationEmail(identity, "verified@example.test")).not.toThrow();
    expect(() => requireVerifiedNotificationEmail(identity, "other@example.test")).toThrow("verified");
    expect(() => requireVerifiedNotificationEmail({ ...identity, verifiedEmails: [] }, "verified@example.test")).toThrow("verified");
  });
  it("requires inviter session ownership before consulting chain state", async () => {
    mocks.wallet.mockClear();
    await expect(requireInvitationAuthority({ ...identity, verifiedSolanaWallets: [] }, "team", address)).rejects.toThrow("verify this inviter");
    expect(mocks.wallet).not.toHaveBeenCalled();
  });
  it("requires on-chain membership in the wallet's approved governance rule", async () => {
    const pda = new PublicKey(address);
    mocks.wallet.mockResolvedValue({ pda });
    mocks.account.mockResolvedValue({ owner: pda, data: new Uint8Array() });
    mocks.policy.mockReturnValue({ wallet: address, approved: true, proposers: [address], approvers: [] });
    await expect(requireInvitationAuthority(identity, "team", address)).resolves.toBeUndefined();
    mocks.policy.mockReturnValue({ wallet: address, approved: true, proposers: [], approvers: [] });
    await expect(requireInvitationAuthority(identity, "team", address)).rejects.toThrow("cannot invite");
    mocks.policy.mockReturnValue({ wallet: "other", approved: true, proposers: [address], approvers: [] });
    await expect(requireInvitationAuthority(identity, "team", address)).rejects.toThrow("cannot invite");
  });
});
