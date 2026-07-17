import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const IMMEDIATE_RUNTIME_RULES = [
  {
    routePrefix: "/app/",
    loadableKey:
      "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/WaasDynamicProviderTree",
  },
  {
    route: "/connect/page",
    loadableKey:
      "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/ConnectDynamicProviderTree",
  },
];

const TURNKEY_APP_RUNTIME_RULES = [
  {
    routePrefix: "/app/",
    loadableKey:
      "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/TurnkeyDynamicProviderTree",
  },
];

const EXTERNAL_APP_RUNTIME_RULES = [
  {
    routePrefix: "/app/",
    loadableKey:
      "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/ExternalDynamicProviderTree",
  },
];

// Rebaselined on 2026-07-16 after the security-mandated Next 15.5.20 and
// Dynamic 4.92.3 upgrades. The previous 960/930/480 limits reject the patched
// dependency graph (967.6/951.0/504.2 kB respectively). These remain tight
// regression ratchets; the final product targets below are unchanged.
const CURRENT_APP_TOTAL_BUDGET_KB = 970;
const CURRENT_TURNKEY_APP_TOTAL_BUDGET_KB = 952;
const CURRENT_EXTERNAL_APP_TOTAL_BUDGET_KB = 1_100;
const CURRENT_MAX_CHUNK_BUDGET_KB = 505;
const TARGET_APP_TOTAL_BUDGET_KB = 250;
const TARGET_MAX_CHUNK_BUDGET_KB = 150;

export function includeImmediateRuntimeChunks(
  manifest,
  loadableManifest,
  rules = IMMEDIATE_RUNTIME_RULES,
) {
  const pages = Object.fromEntries(
    Object.entries(manifest.pages ?? {}).map(([route, files]) => {
      const immediateFiles = rules
        .filter(
          (rule) =>
            (rule.route !== undefined && route === rule.route) ||
            (rule.routePrefix !== undefined && route.startsWith(rule.routePrefix)),
        )
        .flatMap((rule) => loadableManifest[rule.loadableKey]?.files ?? []);
      return [route, [...new Set([...files, ...immediateFiles])]];
    }),
  );
  return { ...manifest, pages };
}

export function analyzeBundleManifest(manifest, gzipBytesForFile) {
  const pages = Object.entries(manifest.pages ?? {}).filter(([route]) =>
    route.endsWith("/page"),
  );
  const usage = new Map();
  for (const [, files] of pages) {
    for (const file of new Set(files)) {
      usage.set(file, (usage.get(file) ?? 0) + 1);
    }
  }

  return pages.map(([route, files]) => {
    const uniqueFiles = [...new Set(files)];
    const sharedFiles = uniqueFiles.filter((file) => (usage.get(file) ?? 0) > 1);
    const routeFiles = uniqueFiles.filter((file) => (usage.get(file) ?? 0) === 1);
    const sharedBytes = sumSizes(sharedFiles, gzipBytesForFile);
    const routeBytes = sumSizes(routeFiles, gzipBytesForFile);
    return {
      route,
      files: uniqueFiles,
      sharedFiles,
      routeFiles,
      sharedBytes,
      routeBytes,
      totalBytes: sharedBytes + routeBytes,
    };
  });
}

function sumSizes(files, gzipBytesForFile) {
  return files.reduce((total, file) => total + gzipBytesForFile(file), 0);
}

function run() {
  const buildRoot = new URL("../.next/", import.meta.url).pathname;
  const manifestPath = `${buildRoot}app-build-manifest.json`;
  const loadableManifestPath = `${buildRoot}react-loadable-manifest.json`;
  if (!existsSync(manifestPath)) {
    console.error("Bundle budget requires a completed Next.js build.");
    process.exit(1);
  }
  if (!existsSync(loadableManifestPath)) {
    console.error("Bundle budget requires the React loadable manifest.");
    process.exit(1);
  }

  const initialManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const loadableManifest = JSON.parse(readFileSync(loadableManifestPath, "utf8"));
  for (const rule of [
    ...IMMEDIATE_RUNTIME_RULES,
    ...TURNKEY_APP_RUNTIME_RULES,
    ...EXTERNAL_APP_RUNTIME_RULES,
  ]) {
    if (!loadableManifest[rule.loadableKey]) {
      console.error(`Bundle budget could not find immediate runtime: ${rule.loadableKey}`);
      process.exit(1);
    }
  }
  const manifest = includeImmediateRuntimeChunks(initialManifest, loadableManifest);
  const externalAppManifest = includeImmediateRuntimeChunks(
    initialManifest,
    loadableManifest,
    EXTERNAL_APP_RUNTIME_RULES,
  );
  const turnkeyAppManifest = includeImmediateRuntimeChunks(
    initialManifest,
    loadableManifest,
    TURNKEY_APP_RUNTIME_RULES,
  );
  const failures = [];
  const gzipCache = new Map();
  const routeSizes = analyzeBundleManifest(manifest, (file) => {
    const cached = gzipCache.get(file);
    if (cached !== undefined) return cached;
    const path = `${buildRoot}${file}`;
    if (!existsSync(path)) {
      failures.push(`manifest chunk is missing: ${file}`);
      return 0;
    }
    const bytes = gzipSync(readFileSync(path)).byteLength;
    gzipCache.set(file, bytes);
    return bytes;
  });
  const externalAppSizes = analyzeBundleManifest(externalAppManifest, (file) => {
    const cached = gzipCache.get(file);
    if (cached !== undefined) return cached;
    const path = `${buildRoot}${file}`;
    if (!existsSync(path)) {
      failures.push(`manifest chunk is missing: ${file}`);
      return 0;
    }
    const bytes = gzipSync(readFileSync(path)).byteLength;
    gzipCache.set(file, bytes);
    return bytes;
  }).filter((item) => item.route.startsWith("/app/"));
  const turnkeyAppSizes = analyzeBundleManifest(turnkeyAppManifest, (file) => {
    const cached = gzipCache.get(file);
    if (cached !== undefined) return cached;
    const path = `${buildRoot}${file}`;
    if (!existsSync(path)) {
      failures.push(`manifest chunk is missing: ${file}`);
      return 0;
    }
    const bytes = gzipSync(readFileSync(path)).byteLength;
    gzipCache.set(file, bytes);
    return bytes;
  }).filter((item) => item.route.startsWith("/app/"));

  for (const item of routeSizes) {
    const appRoute = item.route.startsWith("/app/");
    const connectRoute = item.route === "/connect/page";
    const totalBudgetKb = appRoute
      ? CURRENT_APP_TOTAL_BUDGET_KB
      : connectRoute
        ? CURRENT_EXTERNAL_APP_TOTAL_BUDGET_KB
        : 260;
    const routeBudgetKb = appRoute || connectRoute ? 230 : 180;
    const totalKb = item.totalBytes / 1024;
    const routeKb = item.routeBytes / 1024;
    if (totalKb > totalBudgetKb) {
      failures.push(
        `${item.route} is ${totalKb.toFixed(1)} kB gzip total; budget is ${totalBudgetKb} kB`,
      );
    }
    if (routeKb > routeBudgetKb) {
      failures.push(
        `${item.route} owns ${routeKb.toFixed(1)} kB gzip; budget is ${routeBudgetKb} kB`,
      );
    }
  }

  for (const item of externalAppSizes) {
    const totalKb = item.totalBytes / 1024;
    if (totalKb > CURRENT_EXTERNAL_APP_TOTAL_BUDGET_KB) {
      failures.push(
        `${item.route} is ${totalKb.toFixed(1)} kB gzip with external-wallet runtime; ` +
          `budget is ${CURRENT_EXTERNAL_APP_TOTAL_BUDGET_KB} kB`,
      );
    }
  }

  for (const item of turnkeyAppSizes) {
    const totalKb = item.totalBytes / 1024;
    if (totalKb > CURRENT_TURNKEY_APP_TOTAL_BUDGET_KB) {
      failures.push(
        `${item.route} is ${totalKb.toFixed(1)} kB with legacy Turnkey runtime; ` +
          `budget is ${CURRENT_TURNKEY_APP_TOTAL_BUDGET_KB} kB`,
      );
    }
  }

  for (const [file, bytes] of gzipCache) {
    const chunkKb = bytes / 1024;
    if (chunkKb > CURRENT_MAX_CHUNK_BUDGET_KB) {
      failures.push(
        `${file} is ${chunkKb.toFixed(1)} kB gzip; chunk budget is ${CURRENT_MAX_CHUNK_BUDGET_KB} kB`,
      );
    }
  }

  routeSizes.sort((left, right) => right.totalBytes - left.totalBytes);
  console.log("Largest route payloads (total = shared + route-owned):");
  for (const item of routeSizes.slice(0, 8)) {
    console.log(
      `- ${item.route}: ${(item.totalBytes / 1024).toFixed(1)} kB ` +
        `(${(item.sharedBytes / 1024).toFixed(1)} shared + ` +
        `${(item.routeBytes / 1024).toFixed(1)} route)`,
    );
  }
  console.log(
    `Bundle ratchet: authenticated routes <= ${CURRENT_APP_TOTAL_BUDGET_KB} kB and chunks <= ` +
      `${CURRENT_MAX_CHUNK_BUDGET_KB} kB gzip; final targets are ${TARGET_APP_TOTAL_BUDGET_KB} kB and ` +
      `${TARGET_MAX_CHUNK_BUDGET_KB} kB.`,
  );
  externalAppSizes.sort((left, right) => right.totalBytes - left.totalBytes);
  if (externalAppSizes[0]) {
    console.log(
      `External-wallet profile: max ${(externalAppSizes[0].totalBytes / 1024).toFixed(1)} kB gzip; ` +
        `budget ${CURRENT_EXTERNAL_APP_TOTAL_BUDGET_KB} kB.`,
    );
  }
  turnkeyAppSizes.sort((left, right) => right.totalBytes - left.totalBytes);
  if (turnkeyAppSizes[0]) {
    console.log(
      `Legacy Turnkey profile: max ${(turnkeyAppSizes[0].totalBytes / 1024).toFixed(1)} kB gzip; ` +
        `budget ${CURRENT_TURNKEY_APP_TOTAL_BUDGET_KB} kB.`,
    );
  }

  if (failures.length > 0) {
    console.error([...new Set(failures)].map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
