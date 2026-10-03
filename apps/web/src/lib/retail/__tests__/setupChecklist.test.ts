import { describe, expect, it } from "vitest";
import { buildSetupChecklist, checklistComplete } from "../setupChecklist";

const base = {
  walletPath: "/app/wallet/ops",
  memberCount: 1,
  approvalThreshold: 1,
  timelockSeconds: 0,
  pendingTeammates: 0,
};

describe("buildSetupChecklist", () => {
  it("leaves every step open for a fresh solo wallet", () => {
    const steps = buildSetupChecklist(base);
    expect(steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(steps[0].href).toBe("/app/wallet/ops/members/add");
    expect(steps[1].detail).toMatch(/second approver/);
  });

  it("does not count a threshold as done without a team", () => {
    const steps = buildSetupChecklist({ ...base, approvalThreshold: 2 });
    expect(steps[1].done).toBe(false);
  });

  it("tracks imported signers that are still pending", () => {
    const steps = buildSetupChecklist({
      ...base,
      memberCount: 2,
      pendingTeammates: 2,
    });
    expect(steps[0].done).toBe(false);
    expect(steps[0].detail).toContain("2 imported signers");
  });

  it("completes when team, threshold and delay are set", () => {
    const steps = buildSetupChecklist({
      ...base,
      memberCount: 3,
      approvalThreshold: 2,
      timelockSeconds: 3600,
    });
    expect(checklistComplete(steps)).toBe(true);
  });
});
