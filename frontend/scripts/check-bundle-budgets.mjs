import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

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
  if (!existsSync(manifestPath)) {
    console.error("Bundle budget requires a completed Next.js build.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
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

  for (const item of routeSizes) {
    const appRoute = item.route.startsWith("/app/");
    const totalBudgetKb = appRoute ? 335 : 260;
    const routeBudgetKb = appRoute ? 230 : 180;
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

  routeSizes.sort((left, right) => right.totalBytes - left.totalBytes);
  console.log("Largest route payloads (total = shared + route-owned):");
  for (const item of routeSizes.slice(0, 8)) {
    console.log(
      `- ${item.route}: ${(item.totalBytes / 1024).toFixed(1)} kB ` +
        `(${(item.sharedBytes / 1024).toFixed(1)} shared + ` +
        `${(item.routeBytes / 1024).toFixed(1)} route)`,
    );
  }

  if (failures.length > 0) {
    console.error([...new Set(failures)].map((failure) => `- ${failure}`).join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
