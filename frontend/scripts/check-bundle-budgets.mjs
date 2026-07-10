import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const buildRoot = new URL("../.next/", import.meta.url).pathname;
const manifestPath = `${buildRoot}app-build-manifest.json`;
if (!existsSync(manifestPath)) {
  console.error("Bundle budget requires a completed Next.js build.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
const routeSizes = [];

for (const [route, files] of Object.entries(manifest.pages ?? {})) {
  if (!route.endsWith("/page")) continue;
  const gzipBytes = [...new Set(files)].reduce((total, file) => {
    const path = `${buildRoot}${file}`;
    return existsSync(path) ? total + gzipSync(readFileSync(path)).byteLength : total;
  }, 0);
  const budgetKb = route.startsWith("/app/") ? 335 : 260;
  const sizeKb = gzipBytes / 1024;
  routeSizes.push({ route, sizeKb });
  if (sizeKb > budgetKb) {
    failures.push(`${route} is ${sizeKb.toFixed(1)} kB gzip; budget is ${budgetKb} kB`);
  }
}

routeSizes.sort((a, b) => b.sizeKb - a.sizeKb);
console.log("Largest route payloads:");
for (const item of routeSizes.slice(0, 8)) {
  console.log(`- ${item.route}: ${item.sizeKb.toFixed(1)} kB gzip`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
