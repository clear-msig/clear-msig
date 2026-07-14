import { describe, expect, it } from "vitest";
import { clearSignEnvelopeHash, clearSignPayloadHash } from "@/lib/clearsign";
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
    expect(clearSignPayloadHash(envelope)).toMatch(/^[0-9a-f]{64}$/);
    expect(clearSignEnvelopeHash(envelope)).toMatch(/^[0-9a-f]{64}$/);
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
    expect(clearSignPayloadHash(envelope)).toMatch(/^[0-9a-f]{64}$/);
    expect(clearSignEnvelopeHash(envelope)).toMatch(/^[0-9a-f]{64}$/);
  });
});
