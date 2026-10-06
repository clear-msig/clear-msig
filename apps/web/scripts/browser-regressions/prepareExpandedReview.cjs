// Test-only copy: real pages with deterministic data boundaries. Never publish it.
const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const destination = path.resolve(
  process.argv[2] || "/tmp/clearsig-expanded-review",
);
execFileSync(
  process.execPath,
  [path.join(__dirname, "prepareConnectedReview.cjs"), destination],
  { stdio: "inherit" },
);
const fixture = path.join(__dirname, "connected-fixtures");
fs.copyFileSync(
  path.join(fixture, "expandedData.js"),
  path.join(destination, "src/review-provider/data.js"),
);
// Public marketplace/profile layouts still use their real builders and views.
// Only the server's data-read boundary is synthetic; no real RPC or registry read.
fs.copyFileSync(
  path.join(fixture, "publicRegistry.ts"),
  path.join(destination, "src/lib/agents/serverMarketplaceRegistry.ts"),
);
fs.appendFileSync(
  path.join(destination, "FIXTURE-ONLY.txt"),
  "Expanded variant: synthetic chain bindings, recovery vault, local profiles and policy authoring cache. No canonical authorization or executable descriptor is asserted.\n",
);

fs.copyFileSync(
  path.join(fixture, "ExpandedProvider.jsx"),
  path.join(destination, "src/review-provider/ConnectedProvider.jsx"),
);

// Include the isolated JavaScript fixture route in Next's generated route types.
// Production TypeScript remains strict; the repository tsconfig is untouched.
const tsconfigPath = path.join(destination, "tsconfig.json");
const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
tsconfig.compilerOptions.allowJs = true;
tsconfig.compilerOptions.checkJs = false;
fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
