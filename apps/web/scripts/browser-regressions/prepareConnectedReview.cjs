// Creates an isolated copy. Never enables fixture identities in the repository app.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const webRoot = fs.realpathSync(path.resolve(__dirname, "../.."));
const destination = path.resolve(
  process.argv[2] || "/tmp/clearsig-connected-review",
);
if (destination === webRoot || destination.startsWith(webRoot + path.sep))
  throw new Error("Fixture destination must be outside the source app.");
if (fs.existsSync(destination))
  throw new Error(
    "Destination already exists; choose a new isolated directory.",
  );
if (!fs.existsSync(path.join(webRoot, "node_modules/next")))
  throw new Error("Install the locked frontend dependencies first.");
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(webRoot, "src"), path.join(destination, "src"), {
  recursive: true,
});
for (const name of [
  "package.json",
  "tsconfig.json",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "postcss.config.js",
  "next-env.d.ts",
]) {
  if (fs.existsSync(path.join(webRoot, name)))
    fs.copyFileSync(path.join(webRoot, name), path.join(destination, name));
}
for (const name of ["node_modules", "public"])
  fs.symlinkSync(path.join(webRoot, name), path.join(destination, name), "dir");
const fixtures = path.join(__dirname, "connected-fixtures");
const provider = path.join(destination, "src/review-provider");
fs.mkdirSync(provider);
for (const name of [
  "ConnectedProvider.jsx",
  "wallet.jsx",
  "dynamic.jsx",
  "data.js",
])
  fs.copyFileSync(path.join(fixtures, name), path.join(provider, name));
const reviewRoute = path.join(destination, "src/app/app/review-fixtures");
fs.mkdirSync(reviewRoute, { recursive: true });
fs.copyFileSync(
  path.join(fixtures, "review-page.jsx"),
  path.join(reviewRoute, "page.jsx"),
);
fs.writeFileSync(
  path.join(destination, "next.config.js"),
  `const base=require(${JSON.stringify(path.join(webRoot, "next.config.ts"))}).default;
module.exports={...base,devIndicators:false,experimental:{...base.experimental,optimizePackageImports:base.experimental.optimizePackageImports.filter(x=>x!=="@dynamic-labs/sdk-react-core")},webpack(config,context){config=base.webpack?base.webpack(config,context):config;const root=${JSON.stringify(provider + path.sep)};config.resolve.alias['@/lib/wallet$']=root+'wallet.jsx';config.resolve.alias['@dynamic-labs/sdk-react-core$']=root+'dynamic.jsx';config.plugins.push(new context.webpack.NormalModuleReplacementPlugin(/(?:Waas|External|Turnkey|Connect)DynamicProviderTree(?:\\.tsx)?$/,root+'ConnectedProvider.jsx'));return config;}};\n`,
);
const sourceDirty = Boolean(
  execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal", "--", "."],
    { cwd: webRoot, encoding: "utf8" },
  ).trim(),
);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: webRoot,
  encoding: "utf8",
}).trim();
fs.writeFileSync(
  path.join(destination, "FIXTURE-ONLY.txt"),
  `Synthetic connected UI review. Source HEAD: ${sourceCommit}; frontend worktree dirty: ${sourceDirty}.\nNot authentication, chain evidence or authorization. Never publish this copy.\n`,
);
console.log(
  JSON.stringify(
    {
      destination,
      sourceCommit,
      sourceDirty,
      server:
        "Use port 3105 with the all-zero test-only NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID; run Next from this directory.",
    },
    null,
    2,
  ),
);
