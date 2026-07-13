import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const threshold = Number(process.argv[2] ?? 1_000);
const rows = walk(root)
  .filter((path) => [".ts", ".tsx"].includes(extname(path)))
  .filter((path) => !path.includes("/__tests__/"))
  .map((path) => ({
    path: relative(root, path),
    lines: readFileSync(path, "utf8").split(/\r?\n/).length,
  }))
  .filter((row) => row.lines >= threshold)
  .sort((left, right) => right.lines - left.lines);

console.log(`Runtime modules at or above ${threshold} lines: ${rows.length}`);
for (const row of rows) console.log(`${row.lines}\t${row.path}`);

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
