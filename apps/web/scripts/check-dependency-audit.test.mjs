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
          (row) => row?.severity === "high",
        ).length,
        critical: Object.values(vulnerabilities).filter(
          (row) => row?.severity === "critical",
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

test("rejects incomplete findings even when metadata reports the risk", () => {
  const incomplete = report();
  incomplete.metadata.vulnerabilities.high = 1;
  incomplete.metadata.vulnerabilities.total = 1;
  assert.throws(() => evaluateDependencyAudit(incomplete), /inconsistent counts/);
});

test("rejects malformed severity counts and finding rows", () => {
  for (const count of [-1, 0.5, NaN, Infinity, "0", undefined]) {
    const malformed = report();
    malformed.metadata.vulnerabilities.high = count;
    assert.throws(() => evaluateDependencyAudit(malformed));
  }
  for (const row of [null, {}, { name: "unknown", severity: "unknown" }]) {
    assert.throws(() => evaluateDependencyAudit(report({ unknown: row })));
  }
  assert.throws(() => evaluateDependencyAudit({ ...report(), vulnerabilities: [] }));
  assert.throws(() => evaluateDependencyAudit({ ...report(), error: { code: "EIO" } }));
});

test("accepts moderate findings without hiding them in the report", () => {
  const moderate = report({ example: { name: "example", severity: "moderate" } });
  moderate.metadata.vulnerabilities.moderate = 1;
  assert.deepEqual(evaluateDependencyAudit(moderate), []);
});
