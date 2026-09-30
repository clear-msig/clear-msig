import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

export function evaluateDependencyAudit(report) {
  const counts = report?.metadata?.vulnerabilities;
  if (
    report?.auditReportVersion !== 2 ||
    report?.error !== undefined ||
    typeof report?.vulnerabilities !== "object" ||
    report.vulnerabilities === null ||
    Array.isArray(report.vulnerabilities) ||
    ![...SEVERITIES, "total"].every(
      (severity) => Number.isSafeInteger(counts?.[severity]) && counts[severity] >= 0,
    )
  ) {
    throw new Error(
      "Dependency audit did not return a complete npm audit v2 report; refusing to treat the scan as clean.",
    );
  }

  const vulnerabilities = Object.values(report.vulnerabilities);
  if (
    vulnerabilities.some(
      (row) =>
        typeof row?.name !== "string" ||
        row.name.length === 0 ||
        !SEVERITIES.includes(row.severity),
    ) ||
    counts.total !== vulnerabilities.length ||
    SEVERITIES.some(
      (severity) =>
        counts[severity] !==
        vulnerabilities.filter((row) => row.severity === severity).length,
    )
  ) {
    throw new Error(
      "Dependency audit returned malformed findings or inconsistent counts; refusing to treat the scan as clean.",
    );
  }
  const critical = vulnerabilities.filter((row) => row.severity === "critical");
  const high = vulnerabilities.filter((row) => row.severity === "high");

  if (critical.length > 0 || high.length > 0) {
    const names = [...critical, ...high]
      .map((row) => `${row.severity}:${row.name}`)
      .join(", ");
    throw new Error(`Dependency audit found unaccepted production risk: ${names}`);
  }

  return [];
}

function run() {
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    // npm uses exit 1 for vulnerability findings. Other failures must not be
    // accepted even if the process happened to write audit-shaped stdout.
    if (error.status !== 1) throw error;
    raw = error.stdout;
    if (typeof raw !== "string" || raw.length === 0) throw error;
  }

  evaluateDependencyAudit(JSON.parse(raw));
  console.log("Dependency audit: 0 critical and 0 high production vulnerabilities.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
