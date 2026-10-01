import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

const root = process.cwd();
const require = createRequire(resolve(root, "package.json"));
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));

function browserAliases() {
  const config = { resolve: { alias: {} as Record<string, string> } };
  nextConfig.webpack(config, { isServer: false });
  return config.resolve.alias;
}

describe("same-version browser dependency consolidation", () => {
  it("keeps every Dynamic consumer on its required logger major and shares v4", () => {
    const paths = new Set<string>();
    for (const [path, value] of Object.entries(lock.packages)) {
      const row = value as { dependencies?: Record<string, string> };
      const spec = row.dependencies?.["@dynamic-labs/logger"];
      if (!path || !spec) continue;
      const consumerRequire = createRequire(resolve(root, path, "package.json"));
      const actual = consumerRequire.resolve("@dynamic-labs/logger/package.json");
      const version = JSON.parse(readFileSync(actual, "utf8")).version;
      if (spec === "4.100.3") {
        expect(version).toBe("4.100.3");
        paths.add(actual);
      } else {
        expect(spec === "5.9.2" || spec === "^5.0.0").toBe(true);
        expect(version).toBe("5.9.2");
      }
    }
    expect(paths.size).toBe(1);
  });

  it("shares logger event state while preserving per-instance names and levels", async () => {
    const sdkRequire = createRequire(resolve(root, "node_modules/@dynamic-labs/sdk-react-core/package.json"));
    const solanaRequire = createRequire(resolve(root, "node_modules/@dynamic-labs/solana/package.json"));
    expect(sdkRequire.resolve("@dynamic-labs/logger")).toBe(solanaRequire.resolve("@dynamic-labs/logger"));
    const { Logger } = sdkRequire("@dynamic-labs/logger");
    const a = new Logger("first", "ERROR");
    const b = new Logger("second", "DEBUG");
    expect(a.name).toBe("first");
    expect(b.name).toBe("second");
    expect(a.level).not.toBe(b.level);
    const previous = Logger.troubleshootModeEnabled;
    try {
      Logger.troubleshootModeEnabled = !previous;
      const { Logger: Other } = solanaRequire("@dynamic-labs/logger");
      expect(Other.troubleshootModeEnabled).toBe(!previous);
    } finally {
      Logger.troubleshootModeEnabled = previous;
    }
  });

  it("does not change server resolution or alias SDK/crypto packages", () => {
    const config = { resolve: { alias: {} as Record<string, string> } };
    nextConfig.webpack(config, { isServer: true });
    expect(config.resolve.alias).toEqual({});
    expect(Object.keys(browserAliases()).sort()).toEqual(
      ["has", "snakeCase", "camelCase", "mapKeys", "mapValues"].map((name) => `lodash/${name}$`).sort(),
    );
    expect(require("lodash/package.json").version).toBe(require("lodash-es/package.json").version);
  });

  const cases: Array<[string, unknown[][]]> = [
    ["has", [[{ a: [{ b: 2 }] }, "a[0].b"], [Object.create({ inherited: true }), "inherited"], [null, "x"]]],
    ["snakeCase", [["FooBar déjà Vu"], ["XMLHttpRequest 123"], [null]]],
    ["camelCase", [["foo_bar déjà vu"], ["XML HTTP request"], [null]]],
    ["mapKeys", [[{ a: 1, b: 2 }, (_v: unknown, k: string) => k.toUpperCase()], [JSON.parse('{"__proto__":1,"constructor":2}'), (_v: unknown, k: string) => k]]],
    ["mapValues", [[{ a: { n: 1 }, b: { n: 2 } }, "n"], [JSON.parse('{"__proto__":1,"constructor":2}'), (v: unknown) => v]]],
  ];
  for (const [name, inputs] of cases) {
    it(`preserves ${name} behavior through the actual browser alias`, async () => {
      const esm = await import(/* @vite-ignore */ pathToFileURL(browserAliases()[`lodash/${name}$`]).href);
      const commonjs = require(`lodash/${name}`);
      for (const args of inputs) expect(esm.default(...args)).toEqual(commonjs(...args));
    });
  }
});
