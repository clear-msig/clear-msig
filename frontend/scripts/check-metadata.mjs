import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const imagePath = resolve(root, "public/social/clearsig-og.png");
const retiredRoute = resolve(root, "src/app/opengraph-image.tsx");
const sourcePaths = [
  "src/lib/metadata/site.ts",
  "src/app/layout.tsx",
  "src/app/manifest.ts",
].map((path) => resolve(root, path));
const failures = [];

if (!existsSync(imagePath)) {
  failures.push("missing public/social/clearsig-og.png");
} else {
  const image = readFileSync(imagePath);
  const pngSignature = "89504e470d0a1a0a";
  if (image.subarray(0, 8).toString("hex") !== pngSignature) {
    failures.push("social image is not a PNG");
  } else {
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    if (width !== 1200 || height !== 630) {
      failures.push(`social image is ${width}x${height}; expected 1200x630`);
    }
  }
  if (image.byteLength > 5 * 1024 * 1024) {
    failures.push("social image exceeds the 5 MB Twitter Card limit");
  }
}

if (existsSync(retiredRoute)) {
  failures.push("retired app/opengraph-image.tsx still overrides shared metadata");
}

const metadataSource = sourcePaths.map((path) => readFileSync(path, "utf8")).join("\n");
for (const required of [
  "ClearSig — Sign intents. Not hex.",
  "Policy-driven shared wallets for teams, businesses, DAOs, and AI agents.",
  "/social/clearsig-og.png",
  "summary_large_image",
  "canonical",
]) {
  if (!metadataSource.includes(required)) {
    failures.push(`metadata source is missing '${required}'`);
  }
}

for (const legacy of [
  "Clear Shared Wallets",
  "Clear · Send money with people you trust",
  "The blind-signing crisis, ended.",
  "Live on devnet",
  "#16a34a",
]) {
  if (metadataSource.includes(legacy)) {
    failures.push(`metadata source still contains legacy value '${legacy}'`);
  }
}

if (failures.length > 0) {
  console.error("Metadata contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Metadata contract passed: ClearSig identity, canonical tags, and 1200x630 social card.");
