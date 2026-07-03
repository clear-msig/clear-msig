import { describe, expect, it } from "vitest";
import {
  bindProEscrowPolicy,
  buildProEscrowPolicyCommitment,
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
      address: "AliceSolAddress111111111111111111111111111",
      asset: "SOL",
      amount: "6",
    },
    {
      id: "funder-2",
      name: "Bob",
      entity: "Community fund",
      address: "BobSolAddress11111111111111111111111111111",
      asset: "SOL",
      amount: "4",
    },
  ],
  milestones: [
    {
      id: "milestone-1",
      title: "Design approved",
      recipient: "BuilderSolAddress111111111111111111111111",
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
        recipient: "AliceSolAddress111111111111111111111111111",
        amount: "4.5",
      },
      {
        recipient: "BobSolAddress11111111111111111111111111111",
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
});
