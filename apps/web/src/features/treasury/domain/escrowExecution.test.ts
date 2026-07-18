import { describe, expect, it } from "vitest";
import {
  buildReleaseExecution,
  buildReturnExecution,
  decimalToRaw,
} from "./escrowExecution";
import type { ProEscrowProject } from "@/lib/pro/escrow";

const hash = (character: string) => character.repeat(64);

function project(mode: "spl" | "cross_chain" | "private"): ProEscrowProject {
  return {
    id: "escrow-1",
    title: "Vendor escrow",
    counterparty: "Vendor",
    status: "active",
    createdAt: 1,
    funders: [
      {
        id: "funder-1",
        name: "Funder",
        address: "funder-owner",
        asset: "USDC",
        amount: "3",
        tokenAccount: "funder-token",
      },
    ],
    milestones: [
      {
        id: "milestone-1",
        title: "Delivery",
        recipient: "recipient-owner",
        asset: "USDC",
        amount: "2.5",
        status: "planned",
        tokenAccount: "recipient-token",
      },
    ],
    execution: {
      mode,
      network: mode === "spl" ? "Solana devnet" : "Ethereum Sepolia",
      chainKind: mode === "spl" ? 0 : 1,
      decimals: 6,
      assetId: mode === "spl" ? "mint" : "USDC",
      mint: mode === "spl" ? "mint" : undefined,
      sourceToken: mode === "spl" ? "source-token" : undefined,
      routeHash: mode === "cross_chain" ? hash("a") : undefined,
      settlementArtifactHash: mode === "spl" ? undefined : hash("b"),
      privateEvaluationHash: mode === "private" ? hash("c") : undefined,
    },
  };
}

describe("escrow execution planning", () => {
  it("converts display amounts without floating point", () => {
    expect(decimalToRaw("2.500001", 6)).toBe("2500001");
    expect(() => decimalToRaw("2.5000001", 6)).toThrow();
  });

  it("maps SPL owner and token accounts into one execution request", () => {
    const input = project("spl");
    expect(buildReleaseExecution(input, input.milestones[0], 0)).toEqual({
      kind: "spl_release",
      escrowId: "escrow-1",
      milestoneId: "milestone-1",
      mint: "mint",
      sourceToken: "source-token",
      destinationToken: "recipient-token",
      recipientOwner: "recipient-owner",
      amountTokens: 2_500_000,
    });
  });

  it("keeps cross-chain and private evidence in their matching executors", () => {
    const remote = project("cross_chain");
    expect(buildReturnExecution(remote, [{ recipient: "funder-owner", amount: "0.5" }], [])).toMatchObject({
      kind: "cross_chain_return",
      chainKind: 1,
      amountRaw: "500000",
      routeHash: hash("a"),
      settlementArtifactHash: hash("b"),
    });
    const privateProject = project("private");
    expect(buildReleaseExecution(privateProject, privateProject.milestones[0], 0)).toMatchObject({
      kind: "private_release",
      amountRaw: "2500000",
      privateEvaluationHash: hash("c"),
      settlementArtifactHash: hash("b"),
    });
  });
});
