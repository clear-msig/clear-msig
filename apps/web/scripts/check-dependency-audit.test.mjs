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

test("accepts only the registered high-risk dependency chain", () => {
  const names = evaluateDependencyAudit(
    report({
      "@dynamic-labs/solana-core": {
        name: "@dynamic-labs/solana-core",
        severity: "high",
      },
      "@solana/spl-token": { name: "@solana/spl-token", severity: "high" },
      "@solana/buffer-layout-utils": {
        name: "@solana/buffer-layout-utils",
        severity: "high",
      },
      "bigint-buffer": { name: "bigint-buffer", severity: "high" },
    }),
  );

  assert.deepEqual(names.sort(), [
    "@dynamic-labs/solana-core",
    "@solana/buffer-layout-utils",
    "@solana/spl-token",
    "bigint-buffer",
  ]);
});

test("rejects critical or unregistered high-risk packages", () => {
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
