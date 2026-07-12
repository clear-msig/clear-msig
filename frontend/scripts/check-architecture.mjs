import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const sourceFiles = walk(root).filter((path) => [".ts", ".tsx"].includes(extname(path)));
const pageFiles = sourceFiles.filter((path) => path.endsWith("/page.tsx"));
const failures = [];

const metrics = sourceFiles.map((path) => {
  const source = readFileSync(path, "utf8");
  return {
    path,
    source,
    lines: source.split(/\r?\n/).length,
    client: /^\uFEFF?["']use client["'];/m.test(source),
  };
});

const pages = metrics.filter(({ path }) => pageFiles.includes(path));
const agentModules = metrics.filter(({ path }) => path.includes("/features/agents/"));
const featureModules = metrics.filter(({ path }) => path.includes("/features/"));
const routeLines = pages.reduce((total, file) => total + file.lines, 0);
const clientPages = pages.filter((file) => file.client).length;
const clientRatio = pages.length === 0 ? 0 : clientPages / pages.length;

for (const file of pages) {
  if (file.lines > 1_000) {
    failures.push(`${label(file.path)} has ${file.lines} lines; route entries must stay below 1,000`);
  }
}

for (const file of metrics) {
  if (file.lines > 2_000) {
    failures.push(`${label(file.path)} has ${file.lines} lines; split modules above 2,000`);
  }
  if (file.path.includes("/app/api/") && file.client) {
    failures.push(`${label(file.path)} is an API module marked as a client component`);
  }
  if (
    /from\s+["']nodemailer["']/.test(file.source) &&
    !/^\s*import\s+["']server-only["'];/m.test(file.source)
  ) {
    failures.push(`${label(file.path)} imports nodemailer without a server-only boundary`);
  }
  const importsServerRuntime = file.source
    .split(";")
    .some(
      (statement) =>
        /from\s+["']@\/lib\/[^"']*\/server[^"']*["']/.test(statement) &&
        !/^\s*(?:import|export)\s+type\b/.test(statement),
    );
  if (file.client && importsServerRuntime) {
    failures.push(`${label(file.path)} imports a server runtime into the browser graph`);
  }

  if (file.path.includes("/features/agents/") && file.lines > 900) {
    failures.push(`${label(file.path)} has ${file.lines} lines; agent feature modules are capped at 900`);
  }
  if (file.path.includes("/features/agents/controllers/") && file.lines > 700) {
    failures.push(`${label(file.path)} has ${file.lines} lines; agent controllers are capped at 700`);
  }
  if (file.path.includes("/features/agents/infrastructure/")) {
    if (/^\s*export\s+\*/m.test(file.source)) {
      failures.push(`${label(file.path)} uses a wildcard export; infrastructure ports must be explicit`);
    }
    if (file.lines > 120) {
      failures.push(`${label(file.path)} has ${file.lines} lines; split infrastructure ports above 120`);
    }
  }

  const isAgentBoundary =
    file.path.includes("/features/agents/routes/") ||
    file.path.includes("/features/agents/controllers/") ||
    file.path.includes("/features/agents/ui/") ||
    /\/app\/app\/wallet\/\[name\]\/agents\/.*page\.tsx$/.test(file.path);
  if (isAgentBoundary) {
    const forbidden = importStatements(file.source).find(
      (statement) => {
        const importedPath = resolveImport(file.path, statement);
        return (
          /\/features\/agents\/infrastructure\/(?:browserRuntime|localAgentRuntime)$/.test(
            importedPath,
          ) ||
          /\/lib\/agents\//.test(importedPath) ||
          /\/lib\/(?:wallet|hooks\/useSignWithWallet)/.test(importedPath)
        );
      },
    );
    if (forbidden) {
      failures.push(`${label(file.path)} bypasses the agent feature boundary`);
    }
  }

  if (file.path.includes("/features/agents/ui/")) {
    const importsInfrastructure = importStatements(file.source).some((statement) =>
      resolveImport(file.path, statement).includes("/features/agents/infrastructure/"),
    );
    if (importsInfrastructure) {
      failures.push(`${label(file.path)} imports infrastructure from render-only UI`);
    }
  }

  if (file.path.includes("/features/agents/domain/")) {
    const importsRuntimeBoundary = importStatements(file.source).some(
      (statement) => {
        if (/^\s*(?:import|export)\s+type\b/.test(statement)) return false;
        const importedPath = resolveImport(file.path, statement);
        return (
          importedPath === "react" ||
          importedPath === "next" ||
          importedPath.startsWith("next/") ||
          /\/lib\/wallet/.test(importedPath) ||
          /\/lib\/agents\/(?:client|server)/.test(importedPath)
        );
      },
    );
    if (importsRuntimeBoundary) {
      failures.push(`${label(file.path)} pulls runtime infrastructure into the agent domain`);
    }
  }

  const layer = featureLayer(file.path);
  if (layer?.name !== "agents" && layer?.layer === "ui") {
    const importsInfrastructure = importStatements(file.source).some((statement) => {
      const importedPath = resolveImport(file.path, statement);
      return importedPath.includes(`/features/${layer.name}/infrastructure/`);
    });
    if (importsInfrastructure) {
      failures.push(`${label(file.path)} imports infrastructure from render-only feature UI`);
    }
  }
  if (layer?.name !== "agents" && layer?.layer === "domain") {
    const importsRuntimeBoundary = importStatements(file.source).some((statement) => {
      if (/^\s*(?:import|export)\s+type\b/.test(statement)) return false;
      const importedPath = resolveImport(file.path, statement);
      return (
        importedPath === "react" ||
        importedPath === "next" ||
        importedPath.startsWith("next/") ||
        importedPath.includes(`/features/${layer.name}/infrastructure/`) ||
        importedPath.includes(`/features/${layer.name}/ui/`) ||
        /\/lib\/wallet/.test(importedPath)
      );
    });
    if (importsRuntimeBoundary) {
      failures.push(`${label(file.path)} pulls runtime or UI dependencies into feature domain`);
    }
  }
}

if (routeLines > 26_000) {
  failures.push(`route layer has ${routeLines} lines; budget is 26,000`);
}
if (clientRatio > 0.7) {
  failures.push(`client page ratio is ${(clientRatio * 100).toFixed(1)}%; budget is 70%`);
}
if (metrics.some(({ path }) => path.includes("/app/spike/"))) {
  failures.push("diagnostic spike routes must not ship in the production app tree");
}
if (
  metrics.some(({ path }) =>
    /\/features\/agents\/infrastructure\/(?:browserRuntime|localAgentRuntime)\.ts$/.test(path),
  )
) {
  failures.push("catch-all agent browser runtime barrels must not be reintroduced");
}

console.log(
  `Architecture: ${sourceFiles.length} modules, ${pages.length} pages, ${routeLines} route lines, ` +
    `${clientPages} client pages (${(clientRatio * 100).toFixed(1)}%)`,
);
const largestAgentModule = [...agentModules].sort((a, b) => b.lines - a.lines)[0];
console.log(
  `Agent feature: ${agentModules.length} modules, largest ${largestAgentModule?.lines ?? 0} lines ` +
    `(${largestAgentModule ? label(largestAgentModule.path) : "none"})`,
);
const largestFeatureModules = [...featureModules]
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 5);
console.log("Largest feature modules:");
for (const file of largestFeatureModules) {
  console.log(`- ${label(file.path)}: ${file.lines} lines`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function label(path) {
  return relative(root, path);
}

function importStatements(source) {
  return source
    .split(";")
    .filter((statement) => /^\s*(?:import|export)\b/.test(statement));
}

function resolveImport(sourcePath, statement) {
  const specifier = statement.match(/(?:from\s+)?["']([^"']+)["']/)?.[1] ?? "";
  if (specifier.startsWith("@/")) return join(root, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(sourcePath), specifier);
  return specifier;
}

function featureLayer(path) {
  const match = path.match(/\/features\/([^/]+)\/(domain|infrastructure|ui)\//);
  return match ? { name: match[1], layer: match[2] } : null;
}
