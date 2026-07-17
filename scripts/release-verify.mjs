#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DEFAULT_BACKEND_URL =
  "https://clear-msig-backend-production.up.railway.app";
const DEFAULT_FRONTEND_URL = "https://clearsig.xyz";
const DEFAULT_PROGRAM_ID = "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v";
const DEFAULT_DEVNET_URL = "https://api.devnet.solana.com";

const args = parseArgs(process.argv.slice(2));
const backendUrl = stripTrailingSlash(
  args.backendUrl ?? process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL,
);
const frontendUrl = stripTrailingSlash(
  args.frontendUrl ?? process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL,
);
const programId =
  args.programId ?? process.env.PROGRAM_ID ?? process.env.CLEAR_MSIG_PROGRAM_ID ?? DEFAULT_PROGRAM_ID;
const devnetUrl =
  args.devnetUrl ?? process.env.DEVNET_URL ?? process.env.CLEAR_MSIG_URL ?? DEFAULT_DEVNET_URL;
const solanaKeypair =
  args.keypair ??
  process.env.SOLANA_KEYPAIR ??
  process.env.ANCHOR_WALLET ??
  process.env.PAYER_KEYPAIR ??
  null;

const checks = [];
let failures = 0;
let warnings = 0;

function record(name, status, detail) {
  checks.push({ name, status, detail });
  if (status === "fail") failures += 1;
  if (status === "warn") warnings += 1;
}

function pass(name, detail = "") {
  record(name, "pass", detail);
}

function warn(name, detail) {
  record(name, "warn", detail);
}

function fail(name, detail) {
  record(name, "fail", detail);
}

const localHead = commandOrNull("git", ["rev-parse", "HEAD"]);
if (localHead) pass("local git head", short(localHead));
else fail("local git head", "could not read git HEAD");

const remoteHead = commandOrNull("git", ["ls-remote", "origin", "refs/heads/main"])
  ?.split(/\s+/)[0];
if (remoteHead) {
  if (localHead && remoteHead !== localHead) {
    fail("github main", `origin/main ${short(remoteHead)} != local ${short(localHead)}`);
  } else {
    pass("github main", short(remoteHead));
  }
} else {
  warn("github main", "could not query origin/main");
}

const backendVersion = await fetchJson(`${backendUrl}/version`, "backend version");
if (backendVersion) {
  assertVersion("backend", backendVersion, localHead, programId);
}

const frontendVersion = await fetchJson(`${frontendUrl}/api/version`, "frontend version");
if (frontendVersion) {
  assertVersion("frontend", frontendVersion, localHead, programId);
}

const health = await fetchJson(`${backendUrl}/health`, "backend health");
if (health) {
  if (health.status === "ok") pass("backend health", "status ok");
  else fail("backend health", `unexpected status ${JSON.stringify(health.status)}`);
  if (health.destination_receipt_storage === "redis") {
    pass("redis receipt store", "backend reports redis");
  } else {
    fail(
      "redis receipt store",
      `backend reports ${JSON.stringify(health.destination_receipt_storage)}`,
    );
  }
}

const prices = await fetchJson(`${frontendUrl}/api/prices`, "frontend prices");
if (prices) {
  if (typeof prices.SOL === "number") pass("frontend health", "prices route returned SOL");
  else fail("frontend health", "prices route did not include SOL");
}

await checkClearSignV4(`${backendUrl}/v1/clearsign/v4/prepare`);
checkProgram(programId, devnetUrl, backendVersion, frontendVersion);
checkLocalArtifact(backendVersion, frontendVersion);

for (const check of checks) {
  const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
  console.log(`${icon.padEnd(4)} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

console.log("");
console.log(`Release verification: ${checks.length - failures - warnings} passed, ${warnings} warnings, ${failures} failures.`);
process.exitCode = failures === 0 ? 0 : 1;

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--backend-url") parsed.backendUrl = values[++index];
    else if (value === "--frontend-url") parsed.frontendUrl = values[++index];
    else if (value === "--program-id") parsed.programId = values[++index];
    else if (value === "--devnet-url") parsed.devnetUrl = values[++index];
    else if (value === "--keypair") parsed.keypair = values[++index];
    else if (value === "--help") {
      console.log(`Usage: node scripts/release-verify.mjs [--backend-url URL] [--frontend-url URL] [--program-id PUBKEY] [--devnet-url URL] [--keypair PATH]`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${value}`);
      process.exit(2);
    }
  }
  return parsed;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function fetchJson(url, name) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) {
      fail(name, `${response.status} ${text.slice(0, 160)}`);
      return null;
    }
    return JSON.parse(text);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function assertVersion(label, version, expectedHead, expectedProgramId) {
  if (version.status === "ok") pass(`${label} version`, "status ok");
  else fail(`${label} version`, `unexpected status ${JSON.stringify(version.status)}`);

  const sha = version.commit_sha ?? version.commitSha ?? null;
  if (!sha) {
    warn(`${label} commit`, "version endpoint has no commit sha");
  } else if (expectedHead && sha !== expectedHead) {
    fail(`${label} commit`, `${short(sha)} != local ${short(expectedHead)}`);
  } else {
    pass(`${label} commit`, short(sha));
  }

  const reportedProgram = version.program?.id ?? null;
  if (reportedProgram === expectedProgramId) {
    pass(`${label} program id`, reportedProgram);
  } else {
    fail(`${label} program id`, `${reportedProgram ?? "missing"} != ${expectedProgramId}`);
  }
}

async function checkClearSignV4(url) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({}),
    });
    if (response.status === 404) {
      fail("clearsign v4 endpoint", "returned 404");
      return;
    }
    if (response.status >= 400 && response.status < 500) {
      pass("clearsign v4 endpoint", `reachable (${response.status} validation response)`);
      return;
    }
    if (response.ok) {
      warn("clearsign v4 endpoint", "unexpectedly accepted empty body");
      return;
    }
    fail("clearsign v4 endpoint", `unexpected ${response.status}`);
  } catch (error) {
    fail("clearsign v4 endpoint", error instanceof Error ? error.message : String(error));
  }
}

function checkProgram(expectedProgramId, rpcUrl, backendVersion, frontendVersion) {
  const solanaArgs = [
    "program",
    "show",
    expectedProgramId,
    "--url",
    rpcUrl,
  ];
  if (solanaKeypair) solanaArgs.push("--keypair", solanaKeypair);

  const result = commandResult("solana", solanaArgs);
  if (!result.ok) {
    warn("solana program", result.error ?? "could not inspect program with solana CLI");
    return;
  }
  const output = result.stdout;
  const slot = output.match(/Last Deployed In Slot:\s*(\d+)/)?.[1] ?? null;
  const dataLength = output.match(/Data Length:\s*([0-9]+)/)?.[1] ?? null;
  if (slot) pass("solana program", `slot ${slot}${dataLength ? `, ${dataLength} bytes` : ""}`);
  else fail("solana program", "program show output did not include deployed slot");

  for (const [label, version] of [
    ["backend", backendVersion],
    ["frontend", frontendVersion],
  ]) {
    const expectedSlot =
      version?.program?.expected_deployed_slot ??
      version?.program?.expectedDeployedSlot ??
      null;
    if (!expectedSlot) {
      warn(`${label} program slot metadata`, "not configured");
    } else if (slot && expectedSlot !== slot) {
      fail(`${label} program slot metadata`, `${expectedSlot} != live ${slot}`);
    } else {
      pass(`${label} program slot metadata`, expectedSlot);
    }
  }
}

function checkLocalArtifact(backendVersion, frontendVersion) {
  const artifactPath = "target/deploy/clear_wallet.so";
  if (!existsSync(artifactPath)) {
    warn("local program artifact", `${artifactPath} not present`);
    return;
  }
  const sha = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
  pass("local program artifact", sha);
  for (const [label, version] of [
    ["backend", backendVersion],
    ["frontend", frontendVersion],
  ]) {
    const expectedSha =
      version?.program?.expected_artifact_sha256 ??
      version?.program?.expectedArtifactSha256 ??
      null;
    if (!expectedSha) {
      warn(`${label} artifact metadata`, "not configured");
    } else if (expectedSha !== sha) {
      fail(`${label} artifact metadata`, `${expectedSha} != local ${sha}`);
    } else {
      pass(`${label} artifact metadata`, short(sha, 12));
    }
  }
}

function commandOrNull(command, args) {
  const result = commandResult(command, args);
  return result.ok ? result.stdout.trim() : null;
}

function commandResult(command, args) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    return {
      ok: false,
      stdout: "",
      error: stderr.split("\n")[0] || null,
    };
  }
}

function short(value, length = 7) {
  return String(value).slice(0, length);
}
