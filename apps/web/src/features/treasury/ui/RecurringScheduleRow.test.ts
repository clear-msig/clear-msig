import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PendingRecurringExecution, ProSchedule } from "@/lib/pro/treasury";
import { RecurringScheduleRow } from "./RecurringScheduleRow";

const pending: PendingRecurringExecution = { version: 1, proposalAddress: "proposal", scheduleId: "schedule", status: 2, asset: "SOL", recipient: "recipient", amount: "1", intervalSeconds: 60, firstExecutionAt: 1800000000, paymentCount: 4, policyVersion: "CSP1" };
const row: ProSchedule = { id: "schedule", name: "Rent", category: "vendor", amount: "1", asset: "SOL", cadence: "Weekly", nextRun: "2030-01-01", createdAt: 1, proposalAddress: "proposal", pendingExecution: pending };
const active = { status: "active" as const, nextExecutionAt: 1, remainingPayments: 4, executedPayments: 2 };
function markup(props: Partial<Parameters<typeof RecurringScheduleRow>[0]> = {}) {
  return renderToStaticMarkup(createElement(RecurringScheduleRow, { row, state: active, busy: false, unavailable: false, onRetry() {}, onPay() {}, onRevoke() {}, onRemove() {}, ...props }));
}

describe("recurring request controls", () => {
  it("offers revocation retry while the existing schedule is still active", () => {
    const html = markup();
    expect(html).toContain("Revocation pending");
    expect(html).toContain("Review revocation execution");
    expect(html).not.toContain("Pay now");
    expect(html).toContain('href="/app/proposals/proposal"');
    expect(html).toMatch(/disabled="" aria-label="Revoke Rent"/);
  });

  it("offers activation retry before a schedule exists", () => {
    expect(markup({ row: { ...row, pendingExecution: { ...pending, status: 1 } }, state: null })).toContain("Review activation execution");
  });

  it("keeps legacy requests visible with a manual review path", () => {
    const html = markup({ row: { ...row, pendingExecution: undefined }, state: null });
    expect(html).toContain("no verified retry details");
    expect(html).not.toContain("Review activation execution");
    expect(html).not.toContain("Review revocation execution");
    expect(html).toContain("Review proposal");
    expect(html).toMatch(/disabled="" aria-label="Remove Rent"/);
  });

  it("disables retry while chain reads are unavailable", () => {
    const html = markup({ unavailable: true });
    expect(html).toContain("Checking chain status");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Review revocation execution/);
  });

  it("removes the retry affordance when revocation has reached chain", () => {
    const html = markup({ state: { ...active, status: "revoked" } });
    expect(html).not.toContain("Review revocation execution");
    expect(html).toContain('aria-label="Remove Rent"');
  });
});
