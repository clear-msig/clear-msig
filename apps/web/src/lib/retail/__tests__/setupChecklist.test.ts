import type { IntentWithPda } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { describe, expect, it } from "vitest";
import {
  buildSetupChecklist,
  checklistComplete,
  selectSpendingIntent,
  importedMemberHref,
  ruleAuthorityCopy,
} from "../setupChecklist";

const base = {
  walletPath: "/app/wallet/ops",
  intentIndex: 3,
  memberCount: 1,
  approvalThreshold: 1,
  timelockSeconds: 0,
  pendingTeammates: 0,
};

describe("buildSetupChecklist", () => {
  it("leaves every step open for a fresh solo wallet", () => {
    const steps = buildSetupChecklist(base);
    expect(steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(steps[0].href).toBe("/app/wallet/ops/members/add?intent=3");
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

describe("rule-specific setup", () => {
  const rules = [
    {
      account: {
        approved: true,
        intentType: IntentType.Custom,
        intentIndex: 3,
        approvers: ["a"],
        approvalThreshold: 1,
      },
    },
    {
      account: {
        approved: true,
        intentType: IntentType.Custom,
        intentIndex: 7,
        approvers: ["b", "c", "d"],
        approvalThreshold: 2,
      },
    },
    {
      account: {
        approved: false,
        intentType: IntentType.Custom,
        intentIndex: 8,
      },
    },
    {
      account: {
        approved: true,
        intentType: IntentType.UpdateIntent,
        intentIndex: 2,
      },
    },
  ] as IntentWithPda[];
  it("selects the requested rule without merging rosters or thresholds", () => {
    expect(selectSpendingIntent(rules, "7")).toBe(rules[1]);
    expect(selectSpendingIntent(rules, "3")).toBe(rules[0]);
    expect(selectSpendingIntent(rules, null)).toBe(rules[0]);
  });
  it.each(["99", "8", "2", "03", "-1", "garbage"])(
    "does not silently redirect invalid rule %s",
    (requested) => {
      expect(selectSpendingIntent(rules, requested)).toBeNull();
    },
  );
  it("does not treat an optional delay as missing shared approval", () => {
    const steps = buildSetupChecklist({
      ...base,
      memberCount: 3,
      approvalThreshold: 2,
    });
    expect(checklistComplete(steps)).toBe(true);
    expect(steps[2].title).toContain("optional");
    expect(steps[2].href).toBe("/app/wallet/ops/rules#rule-3");
    expect(steps[1].href).toBe("/app/wallet/ops/policy?intent=3");
  });
  it("carries the exact imported address and approver role to explicit review", () => {
    const url = new URL(
      importedMemberHref("Ops / team", 7, "exact/address+value"),
      "https://example.test",
    );
    expect(url.searchParams.get("address")).toBe("exact/address+value");
    expect(url.searchParams.get("intent")).toBe("7");
    expect(url.searchParams.get("role")).toBe("approver");
  });
  it("reports creator-only governance separately from payment authority", () => {
    expect(
      ruleAuthorityCopy(
        { approvers: ["creator"], approvalThreshold: 1 },
        "creator",
      ),
    ).toContain("(creator only)");
    expect(
      ruleAuthorityCopy(
        { approvers: ["other"], approvalThreshold: 1 },
        "creator",
      ),
    ).not.toContain("creator only");
    expect(
      ruleAuthorityCopy(
        { approvers: ["creator", "other"], approvalThreshold: 2 },
        "creator",
      ),
    ).toContain("2 of 2 governance approvals");
  });
});
