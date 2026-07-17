import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { includeImmediateRuntimeChunks } from "./check-bundle-budgets.mjs";

const SDK_FAMILIES = [
  { name: "Dynamic", pattern: /node_modules\/@dynamic-labs(?:\/|\\)/ },
  { name: "Ledger", pattern: /node_modules\/@ledgerhq(?:\/|\\)/ },
  { name: "Solana Web3", pattern: /node_modules\/@solana\/web3\.js(?:\/|\\)/ },
  { name: "Framer Motion", pattern: /node_modules\/framer-motion(?:\/|\\)/ },
];

const WAAS_RUNTIME_KEY =
  "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/WaasDynamicProviderTree";
const TURNKEY_RUNTIME_KEY =
  "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/TurnkeyDynamicProviderTree";
const EXTERNAL_RUNTIME_KEY =
  "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/ExternalDynamicProviderTree";

export function profileSdkModules(
  stats,
  manifest,
  loadableManifest,
  runtimeKey = WAAS_RUNTIME_KEY,
) {
  if (!loadableManifest[runtimeKey]) {
    throw new Error(`Bundle profile could not find wallet runtime: ${runtimeKey}`);
  }
  const profiledManifest = includeImmediateRuntimeChunks(manifest, loadableManifest, [
    { routePrefix: "/app/", loadableKey: runtimeKey },
  ]);
  const fileChunks = new Map();
  for (const chunk of stats.chunks ?? []) {
    for (const file of chunk.files ?? []) {
      const chunks = fileChunks.get(file) ?? new Set();
      chunks.add(String(chunk.id));
      fileChunks.set(file, chunks);
    }
  }

  const modules = leafModules(stats.modules ?? []).map((module) => ({
    name: String(module.name ?? module.identifier ?? ""),
    size: Number(module.size ?? 0),
    chunks: new Set((module.chunks ?? []).map(String)),
  }));

  return Object.entries(profiledManifest.pages ?? {})
    .filter(([route]) => route.endsWith("/page"))
    .map(([route, files]) => {
      const routeChunks = new Set(
        [...new Set(files)].flatMap((file) => [...(fileChunks.get(file) ?? [])]),
      );
      const families = Object.fromEntries(
        SDK_FAMILIES.map((family) => [
          family.name,
          modules
            .filter(
              (module) =>
                family.pattern.test(module.name) &&
                [...module.chunks].some((chunk) => routeChunks.has(chunk)),
            )
            .reduce((total, module) => total + module.size, 0),
        ]),
      );
      return { route, families };
    });
}

function leafModules(modules) {
  return modules.flatMap((module) =>
    module.modules?.length ? leafModules(module.modules) : [module],
  );
}

function run() {
  const buildRoot = new URL("../.next/", import.meta.url).pathname;
  const paths = {
    stats: `${buildRoot}client-bundle-stats.json`,
    manifest: `${buildRoot}app-build-manifest.json`,
    loadable: `${buildRoot}react-loadable-manifest.json`,
  };
  for (const [label, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      console.error(`Bundle profile is missing ${label}: ${path}`);
      process.exit(1);
    }
  }

  const stats = JSON.parse(readFileSync(paths.stats, "utf8"));
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const loadableManifest = JSON.parse(readFileSync(paths.loadable, "utf8"));
  for (const [label, runtimeKey] of [
    ["WaaS", WAAS_RUNTIME_KEY],
    ["Legacy Turnkey", TURNKEY_RUNTIME_KEY],
    ["External", EXTERNAL_RUNTIME_KEY],
  ]) {
    const rows = profileSdkModules(
      stats,
      manifest,
      loadableManifest,
      runtimeKey,
    )
      .filter((row) => row.route.startsWith("/app/"))
      .sort(
        (left, right) =>
          Object.values(right.families).reduce((sum, bytes) => sum + bytes, 0) -
          Object.values(left.families).reduce((sum, bytes) => sum + bytes, 0),
      );

    console.log(
      `${label} authenticated route SDK modules (parsed bytes, not gzip estimates):`,
    );
    for (const row of rows.slice(0, 20)) {
      const values = Object.entries(row.families)
        .map(([name, bytes]) => `${name} ${(bytes / 1024).toFixed(1)} kB`)
        .join(", ");
      console.log(`- ${row.route}: ${values}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
