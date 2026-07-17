import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const allowedHigh = new Set([
  "@dynamic-labs/solana-core",
  "@solana/buffer-layout-utils",
  "@solana/spl-token",
  "bigint-buffer",
]);

export function evaluateDependencyAudit(report) {
  const counts = report?.metadata?.vulnerabilities;
  if (
    report?.auditReportVersion !== 2 ||
    typeof report?.vulnerabilities !== "object" ||
    report.vulnerabilities === null ||
    typeof counts?.critical !== "number" ||
    typeof counts?.high !== "number"
  ) {
    throw new Error(
      "Dependency audit did not return a complete npm audit v2 report; refusing to treat the scan as clean.",
    );
  }

  const vulnerabilities = Object.values(report.vulnerabilities);
  const critical = vulnerabilities.filter((row) => row.severity === "critical");
  const high = vulnerabilities.filter((row) => row.severity === "high");
  const unexpectedHigh = high.filter((row) => !allowedHigh.has(row.name));

  if (critical.length > 0 || unexpectedHigh.length > 0) {
    const names = [...critical, ...unexpectedHigh]
      .map((row) => `${row.severity}:${row.name}`)
      .join(", ");
    throw new Error(`Dependency audit found unaccepted production risk: ${names}`);
  }

  return high.map((row) => row.name);
}

function run() {
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    raw = error.stdout;
    if (typeof raw !== "string" || raw.length === 0) throw error;
  }

  const high = evaluateDependencyAudit(JSON.parse(raw));
  console.log(
    `Dependency audit: 0 critical, ${high.length} allowlisted high package nodes (${high.join(", ")}).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
