import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDependencyAudit } from "./check-dependency-audit.mjs";

function report(vulnerabilities = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: Object.values(vulnerabilities).filter(
          (row) => row.severity === "high",
        ).length,
        critical: Object.values(vulnerabilities).filter(
          (row) => row.severity === "critical",
        ).length,
        total: Object.keys(vulnerabilities).length,
      },
    },
  };
}

test("accepts a production graph with no high or critical findings", () => {
  assert.deepEqual(evaluateDependencyAudit(report()), []);
});

test("rejects every critical or high-risk package", () => {
  assert.throws(() =>
    evaluateDependencyAudit(
      report({ unexpected: { name: "unexpected", severity: "high" } }),
    ),
  );
  assert.throws(() =>
    evaluateDependencyAudit(
      report({ critical: { name: "critical", severity: "critical" } }),
    ),
  );
});

test("fails closed when npm returns an error document instead of an audit", () => {
  assert.throws(() =>
    evaluateDependencyAudit({
      message: "audit endpoint returned an error",
      error: { code: "ENOTFOUND" },
    }),
  );
});
