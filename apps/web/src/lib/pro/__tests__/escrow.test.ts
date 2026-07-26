import { describe, expect, it } from "vitest";
import {
  bindProEscrowPolicy,
  buildProEscrowReleaseEnvelope,
  buildProEscrowPolicyCommitment,
  buildProEscrowReturnEnvelope,
  buildProEscrowReturnRows,
  type ProEscrowProject,
} from "@/lib/pro/escrow";

const baseProject: ProEscrowProject = {
  id: "escrow-1",
  title: "Website redesign",
  counterparty: "Acme",
  status: "active",
  createdAt: 1_782_000_000_000,
  funders: [
    {
      id: "funder-1",
      name: "Alice",
      entity: "Fund entity",
      address: "2ZeWpoE8G2GMLDmeYvsWmBkWmD25kHZch9uNibb6yGFu",
      asset: "SOL",
      amount: "6",
    },
    {
      id: "funder-2",
      name: "Bob",
      entity: "Community fund",
      address: "CZHSqsCMFrRxunPFqMgSdq7HUdwJrweXGd1pajuHZGMW",
      asset: "SOL",
      amount: "4",
    },
  ],
  milestones: [
    {
      id: "milestone-1",
      title: "Design approved",
      recipient: "BgkCbSQTwnKsR9fTv9w71LodMStcAihib8SgJ5SZHU8u",
      recipientEntity: "Construction cooperative",
      asset: "SOL",
      amount: "2.5",
      status: "released",
    },
  ],
};

describe("Pro escrow", () => {
  it("returns remaining SOL pro rata to original funders", () => {
    expect(buildProEscrowReturnRows(baseProject)).toEqual([
      {
        recipient: "2ZeWpoE8G2GMLDmeYvsWmBkWmD25kHZch9uNibb6yGFu",
        amount: "4.5",
      },
      {
        recipient: "CZHSqsCMFrRxunPFqMgSdq7HUdwJrweXGd1pajuHZGMW",
        amount: "3",
      },
    ]);
  });

  it("binds a stable policy commitment to escrow terms", () => {
    const a = bindProEscrowPolicy(baseProject);
    const b = bindProEscrowPolicy({
      ...baseProject,
      status: "disputed",
      updatedAt: 1_782_000_100_000,
    });

    expect(a.policy?.commitment).toBeTruthy();
    expect(a.policy?.commitment).toBe(b.policy?.commitment);
    expect(a.policy?.releaseRequires).toBe("wallet_approval");
    expect(a.policy?.unwindRequires).toBe("wallet_approval");
  });

  it("changes the policy commitment when funder terms change", () => {
    const original = buildProEscrowPolicyCommitment(baseProject);
    const changed = buildProEscrowPolicyCommitment({
      ...baseProject,
      funders: [
        {
          ...baseProject.funders[0],
          amount: "7",
        },
        baseProject.funders[1],
      ],
    });

    expect(changed).not.toBe(original);
  });

  it("binds funder and recipient entities into the policy commitment", () => {
    const original = buildProEscrowPolicyCommitment(baseProject);
    const changedFunderEntity = buildProEscrowPolicyCommitment({
      ...baseProject,
      funders: [
        {
          ...baseProject.funders[0],
          entity: "Different fund SPV",
        },
        baseProject.funders[1],
      ],
    });
    const changedRecipientEntity = buildProEscrowPolicyCommitment({
      ...baseProject,
      milestones: [
        {
          ...baseProject.milestones[0],
          recipientEntity: "Different build cooperative",
        },
      ],
    });

    expect(changedFunderEntity).not.toBe(original);
    expect(changedRecipientEntity).not.toBe(original);
  });

  it("builds a typed ClearSign envelope for milestone release", () => {
    const envelope = buildProEscrowReleaseEnvelope({
      walletName: "Team",
      walletId: "TeamWallet111",
      project: baseProject,
      milestone: baseProject.milestones[0],
      actionId: "release-1",
      nonce: "nonce-1",
      expiresAt: 1_782_988_800,
    });

    expect(envelope.kind).toBe("release_milestone");
    expect(envelope.payload.escrowId).toBe("escrow-1");
    expect(envelope.payload.milestoneId).toBe("milestone-1");
    expect(envelope.policyCommitment).toBe(
      bindProEscrowPolicy(baseProject).policy?.commitment,
    );
    expect(envelope.payload).toMatchObject({
      escrowId: "escrow-1",
      milestoneId: "milestone-1",
      recipient: "BgkCbSQTwnKsR9fTv9w71LodMStcAihib8SgJ5SZHU8u",
    });
  });

  it("builds a typed ClearSign envelope for pro-rata escrow return", () => {
    const rows = buildProEscrowReturnRows(baseProject);
    const envelope = buildProEscrowReturnEnvelope({
      walletName: "Team",
      walletId: "TeamWallet111",
      project: baseProject,
      rows,
      actionId: "return-1",
      nonce: "nonce-1",
      expiresAt: 1_782_988_800,
    });

    expect(envelope.kind).toBe("return_escrow_funds");
    expect(envelope.payload.escrowId).toBe("escrow-1");
    expect(envelope.payload.returns).toHaveLength(2);
    expect(envelope.payload.returns[0]).toMatchObject({
      recipient: "2ZeWpoE8G2GMLDmeYvsWmBkWmD25kHZch9uNibb6yGFu",
      amount: "4.5",
      asset: "SOL",
    });
  });

  it("binds SPL token accounts to the readable token release", () => {
    const tokenProject: ProEscrowProject = {
      ...baseProject,
      funders: [{ ...baseProject.funders[0], asset: "USDC", tokenAccount: "FunderToken111" }],
      milestones: [{ ...baseProject.milestones[0], asset: "USDC", amount: "2.5", tokenAccount: "RecipientToken111" }],
      execution: {
        mode: "spl",
        network: "Solana devnet",
        chainKind: 0,
        decimals: 6,
        assetId: "Mint111",
        mint: "Mint111",
        sourceToken: "TreasuryToken111",
      },
    };
    const release = buildProEscrowReleaseEnvelope({
      walletName: "Team",
      project: tokenProject,
      milestone: tokenProject.milestones[0],
    });
    expect(release.payload).toMatchObject({
      asset: "Mint111",
      assetEncoding: "solana_pubkey",
      displayAsset: "USDC",
      decimals: 6,
      execution: {
        mode: "spl",
        mint: "Mint111",
        sourceToken: "TreasuryToken111",
        destinationToken: "RecipientToken111",
        recipientOwner: tokenProject.milestones[0].recipient,
      },
    });
  });

  it("binds cross-chain and private settlement evidence", () => {
    const hash = (character: string) => character.repeat(64);
    const remoteProject: ProEscrowProject = {
      ...baseProject,
      funders: [baseProject.funders[0]],
      milestones: [{ ...baseProject.milestones[0], asset: "USDC" }],
      execution: {
        mode: "cross_chain",
        network: "Ethereum Sepolia",
        chainKind: 1,
        decimals: 6,
        assetId: "USDC",
        routeHash: hash("a"),
        settlementArtifactHash: hash("b"),
      },
    };
    const remote = buildProEscrowReleaseEnvelope({
      walletName: "Team",
      project: remoteProject,
      milestone: remoteProject.milestones[0],
    });
    expect(remote.network).toBe("Ethereum Sepolia");
    expect(remote.payload).toMatchObject({
      recipientEncoding: "sha256_text",
      assetEncoding: "sha256_text",
      execution: {
        mode: "cross_chain",
        routeHash: hash("a"),
        settlementArtifactHash: hash("b"),
      },
    });

    const privateProject: ProEscrowProject = {
      ...remoteProject,
      execution: {
        ...remoteProject.execution!,
        mode: "private",
        privateEvaluationHash: hash("c"),
      },
    };
    const privateRelease = buildProEscrowReleaseEnvelope({
      walletName: "Team",
      project: privateProject,
      milestone: privateProject.milestones[0],
    });
    expect(privateRelease.payload.execution).toEqual({
      mode: "private",
      privateEvaluationHash: hash("c"),
      settlementArtifactHash: hash("b"),
    });
  });
});
