import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const registryPath = join(repositoryRoot, "examples/intents/registry-v1.json");
const outputPath = join(
  repositoryRoot,
  "frontend/src/lib/intents/generatedRegistry.ts",
);

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const generated = renderRegistry(registry);

if (process.argv.includes("--write")) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
  process.stdout.write(`Updated ${outputPath}\n`);
} else {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    throw new Error(
      "Generated intent registry is stale. Run `npm run check:intents -- --write`.",
    );
  }
  process.stdout.write(
    `Intent registry: ${registry.templates.length} versioned templates\n`,
  );
}

function renderRegistry(value) {
  const templates = value.templates
    .map(
      (entry) => `  {
    id: ${JSON.stringify(entry.id)},
    file: ${JSON.stringify(entry.file)},
    chainKind: ${entry.chainKind},
    chain: ${JSON.stringify(entry.chain)},
    template: ${JSON.stringify(entry.template)},
    defaultForChain: ${entry.defaultForChain},
  },`,
    )
    .join("\n");

  return `// Generated from examples/intents/registry-v1.json. Do not edit manually.

export const INTENT_SCHEMA_VERSION = ${value.schemaVersion} as const;

export const INTENT_TEMPLATES = [
${templates}
] as const;

export type IntentTemplateId = (typeof INTENT_TEMPLATES)[number]["id"];

export function templateFileForChainKind(chainKind: number): string {
  const registered = INTENT_TEMPLATES.find(
    (entry) => entry.chainKind === chainKind && entry.defaultForChain,
  );
  if (!registered) {
    throw new Error(\`No default intent template for chainKind \${chainKind}\`);
  }
  return registered.file;
}

export function templateFileForId(id: IntentTemplateId): string {
  const registered = INTENT_TEMPLATES.find((entry) => entry.id === id);
  if (!registered) {
    throw new Error(\`Unknown intent template \${id}\`);
  }
  return registered.file;
}
`;
}
