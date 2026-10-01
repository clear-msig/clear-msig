import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
const mocks = vi.hoisted(() => ({
  kind: 6,
  finalized: false,
  submitted: false,
  response: {} as Record<string, unknown>,
  execute: vi.fn(),
  read: vi.fn(),
}));
const address = "11111111111111111111111111111111";
const summary = () => ({
  actionKindCode: mocks.kind,
  envelopeHash: "a".repeat(64),
  payloadHash: "b".repeat(64),
  policyCommitment: "c".repeat(64),
  signableText: "ClearSig Approval\n\nExact synthetic policy",
  canonicalIntentHex: "00",
});
vi.mock("react", () => ({ useCallback: (value: unknown) => value }));
vi.mock("@/lib/hooks/useRequestIdentity", () => ({
  useRequestIdentity: () => ({
    capture: () => ({ accountKey: "d".repeat(64), assertCurrent: () => {} }),
  }),
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "fixture-policy" } }),
  useWallet: () => ({
    pickSigner: () => new PublicKey("11111111111111111111111111111111"),
  }),
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({
    signTypedDescriptor: async () => ({ signature: "synthetic" }),
  }),
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
        intentIndex: 0,
        proposers: ["11111111111111111111111111111111"],
        approvers: ["11111111111111111111111111111111"],
        approvalThreshold: 1,
      },
    },
  ],
}));
vi.mock("@/lib/policies/persistentWalletPolicy", () => ({
  buildPersistentPersonalPolicyTargets: async () => [
    {
      scope: mocks.kind === 16 ? "asset" : "wallet",
      assetId: "11111111111111111111111111111111",
      scopeKind: 1,
      decimals: 9,
      ticker: "SYNTHETIC",
      policyCommitmentHex: "f".repeat(64),
      policyBytesHex: "00",
      chainKind: 0,
      summary: "Synthetic policy",
    },
  ],
  currentWalletPolicyCommitment: async () => "e".repeat(64),
  currentAssetPolicyCommitment: async () => "e".repeat(64),
}));
vi.mock("@/lib/clearsign", () => ({
  prepareClearSignV4Action: async () => summary(),
  clearSignProfileForSigner: () => ({}),
  randomActionLabel: () => "synthetic",
}));
vi.mock("@/lib/chain/approveIfNeeded", () => ({
  approveIfNeeded: async () => ({ needsApproveSignature: false }),
}));
vi.mock("@/lib/chain/proposals", () => ({
  waitForProposalApproval: async () => true,
}));
vi.mock("@/lib/clearsign/inlineApproval", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reviewedCreationProposalAddress: () => address,
  assertSubmittedCreation: () => address,
}));
vi.mock("@/lib/clearsign/readProposalReview", () => ({
  readCanonicalProposalReview: mocks.read,
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: {
      createTypedProposal: async () => ({
        proposal_pubkey: "11111111111111111111111111111111",
        expiry: 1900000000,
      }),
    },
    submit: {
      createTypedProposal: async () => ({
        proposal: "11111111111111111111111111111111",
      }),
    },
    executeTypedWalletPolicyUpdate: mocks.execute,
    executeTypedAssetPolicyUpdate: mocks.execute,
  },
}));
import { usePersistPersonalWalletPolicy } from "@/lib/hooks/usePersistWalletPolicy";
import { requestRecovery } from "../requestRecovery";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.finalized = false;
  mocks.submitted = false;
  for (const entry of requestRecovery.snapshot()) {
    if (entry.phase === "execution")
      requestRecovery.resolveExecution(entry.endpoint, entry.proposal);
    else requestRecovery.acknowledgeSeparateRequest(entry.key);
  }
  mocks.execute.mockImplementation(async () => {
    mocks.submitted = true;
    return mocks.response;
  });
  mocks.read.mockImplementation(async () => ({
    status: mocks.finalized && mocks.submitted ? 2 : 1,
    binding: { actionKind: mocks.kind, wallet: address },
    envelopeHash: summary().envelopeHash,
    payloadHash: summary().payloadHash,
    document: summary().signableText,
  }));
});
describe("policy persistence never reports activation from API acceptance alone", () => {
  for (const kind of [6, 16]) {
    it(`kind${kind}: empty execution response preserves saved request and blocks updated`, async () => {
      mocks.kind = kind;
      mocks.response = {};
      await expect(
        usePersistPersonalWalletPolicy()("Policy fixture"),
      ).rejects.toThrow(/outcome is unknown/);
      expect(
        requestRecovery.executionFor("fixture-policy", address)?.outcome,
      ).toBe("unknown");
      expect(mocks.execute.mock.calls[0].at(-1)).toEqual({ retry: false });
    });
    it(`kind${kind}: valid signature without finalized execution stays pending`, async () => {
      mocks.kind = kind;
      mocks.response = {
        txid: bs58.encode(new Uint8Array(64).fill(7)),
        proposal: address,
        path:
          kind === 6
            ? "typed_wallet_policy_update"
            : "typed_asset_policy_update",
      };
      await expect(
        usePersistPersonalWalletPolicy()("Policy fixture"),
      ).rejects.toThrow(/verification is pending/);
      expect(
        requestRecovery.executionFor("fixture-policy", address)?.outcome,
      ).toBe("submitted");
    });
    it(`kind${kind}: exact finalized execution permits updated`, async () => {
      mocks.kind = kind;
      mocks.finalized = true;
      mocks.response = {
        txid: bs58.encode(new Uint8Array(64).fill(7)),
        proposal: address,
        path:
          kind === 6
            ? "typed_wallet_policy_update"
            : "typed_asset_policy_update",
      };
      expect(await usePersistPersonalWalletPolicy()("Policy fixture")).toEqual({
        updated: 1,
        skipped: 0,
        waiting: 0,
      });
      expect(requestRecovery.snapshot()).toHaveLength(0);
    });
  }
});
