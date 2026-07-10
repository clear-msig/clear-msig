import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

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
const routeLines = pages.reduce((total, file) => total + file.lines, 0);
const clientPages = pages.filter((file) => file.client).length;
const clientRatio = pages.length === 0 ? 0 : clientPages / pages.length;

for (const file of pages) {
  if (file.lines > 1_000) {
    failures.push(`${label(file.path)} has ${file.lines} lines; route entries must stay below 1,000`);
  }
}

for (const file of metrics) {
  if (file.lines > 4_200) {
    failures.push(`${label(file.path)} has ${file.lines} lines; split modules above 4,200`);
  }
  if (file.path.includes("/app/api/") && file.client) {
    failures.push(`${label(file.path)} is an API module marked as a client component`);
  }
  const importsAgentServerRuntime = file.source
    .split(";")
    .some(
      (statement) =>
        statement.includes("@/lib/agents/server") &&
        !/^\s*import\s+type\b/.test(statement),
    );
  if (file.client && importsAgentServerRuntime) {
    failures.push(`${label(file.path)} imports an agent server runtime into the browser graph`);
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

console.log(
  `Architecture: ${sourceFiles.length} modules, ${pages.length} pages, ${routeLines} route lines, ` +
    `${clientPages} client pages (${(clientRatio * 100).toFixed(1)}%)`,
);

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
