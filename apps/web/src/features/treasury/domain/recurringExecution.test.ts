import { describe, expect, it } from "vitest";
import type { PendingRecurringExecution, ProSchedule } from "@/lib/pro/treasury";
import { recurringExecutionApplied, requireRecurringExecution } from "./recurringExecution";

const operation: PendingRecurringExecution = { version: 1, proposalAddress: "proposal", scheduleId: "schedule", status: 2, asset: "SOL", recipient: "recipient", amount: "1.000000001", intervalSeconds: 60, firstExecutionAt: 1800000000, paymentCount: 4, policyVersion: "CSP1" };
const row: ProSchedule = { id: "schedule", name: "Rent", category: "vendor", amount: "1.000000001", asset: "SOL", cadence: "Weekly", nextRun: "2030-01-01", createdAt: 1, proposalAddress: "proposal", pendingExecution: operation };

describe("persisted recurring execution contract", () => {
  it("returns a copy of the exact pending operation", () => {
    const result = requireRecurringExecution(row);
    expect(result).toEqual(operation);
    expect(result).not.toBe(operation);
  });

  it.each([
    { version: 2 }, { status: 3 }, { scheduleId: "other" }, { proposalAddress: "other" },
    { intervalSeconds: 0 }, { intervalSeconds: 1.5 }, { intervalSeconds: 0x100000000 },
    { firstExecutionAt: -1 }, { firstExecutionAt: Number.MAX_SAFE_INTEGER + 1 },
    { paymentCount: 0 }, { paymentCount: 1001 }, { asset: "ETH" }, { policyVersion: "CSP3" },
    { amount: "-1" }, { amount: "1e3" }, { amount: "0.0000000001" }, { amount: "9".repeat(100000) },
  ])("rejects inconsistent or unsupported retry metadata %#", (patch) => {
    expect(() => requireRecurringExecution({ ...row, pendingExecution: { ...operation, ...patch } as PendingRecurringExecution })).toThrow();
  });

  it("does not infer activation for legacy records", () => {
    expect(() => requireRecurringExecution({ ...row, pendingExecution: undefined })).toThrow("no verified retry details");
  });

  it("requires every bound USDC account", () => {
    const token = { ...operation, asset: "USDC" as const, amount: "1.000001", policyVersion: "CSP2" as const, mint: "mint", sourceToken: "source", destinationToken: "destination", recipientOwner: "owner" };
    expect(requireRecurringExecution({ ...row, pendingExecution: token })).toEqual(token);
    for (const key of ["mint", "sourceToken", "destinationToken", "recipientOwner"]) {
      expect(() => requireRecurringExecution({ ...row, pendingExecution: { ...token, [key]: undefined } })).toThrow("bound token accounts");
    }
  });

  it("requires the target chain state before clearing a pending request", () => {
    expect(recurringExecutionApplied(operation, { status: "active" })).toBe(false);
    expect(recurringExecutionApplied(operation, { status: "complete" })).toBe(false);
    expect(recurringExecutionApplied(operation, { status: "revoked" })).toBe(true);
    expect(recurringExecutionApplied(operation, null)).toBe(false);
    expect(recurringExecutionApplied({ ...operation, status: 1 }, { status: "active" })).toBe(true);
    expect(recurringExecutionApplied({ ...operation, status: 1 }, { status: "complete" })).toBe(true);
    expect(recurringExecutionApplied({ ...operation, status: 1 }, { status: "revoked" })).toBe(false);
  });
});
