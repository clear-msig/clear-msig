const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");
const { chromium } = require("playwright"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, "../.."),
  out = process.env.CLEARSIG_REVIEW_OUTPUT || path.join(require("node:os").tmpdir(), "clearsig-checklist-review");
fs.mkdirSync(out, { recursive: true });
const mocks = {
  "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
  "next/navigation": `export const useParams=()=>({name:'Synthetic'});export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:url=>location.assign(url),back:()=>history.back()});`,
  "@/lib/wallet": `export const useWallet=()=>({publicKey:{toBase58:()=> '11111111111111111111111111111111'},pickSigner:()=>null});export const useConnection=()=>({connection:{rpcEndpoint:'synthetic'}});`,
  "@/lib/chain/wallets": `export const fetchWalletByName=async()=>window.fixture.wallet;`,
  "@/lib/chain/intents": `export const listIntents=async()=>window.fixture.intents;`,
  "@/lib/hooks/useSignWithWallet": `export const useSignWithWallet=()=>({signTypedDescriptor:()=>{throw Error('Synthetic fixture cannot sign')}});`,
  "@/lib/hooks/useRequestIdentity": `export const useRequestIdentity=()=>({capture:()=>({assertCurrent(){}})});`,
  "@/lib/hooks/useContacts": `export const useContacts=()=>({contacts:[],add:()=>{},upsert:()=>{}});`,
  "@/components/ui/Toast": `export const useToast=()=>({push:()=>{}});`,
  "@/lib/hooks/completeTypedGovernance": `export const completeTypedGovernance=()=>{throw Error('Synthetic fixture cannot submit')};`,
};
(async () => {
  require("node:child_process").execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli.js", {paths:[root]}), "-i", root+"/src/app/globals.css", "-o", out+"/style.css"], {cwd:root, stdio:"pipe"});
  await esbuild.build({
    entryPoints: [__dirname + "/setupChecklist.fixture.jsx"],
    outfile: out + "/bundle.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    tsconfig: root + "/tsconfig.json",
    nodePaths: [root + "/node_modules"],
    plugins: [
      {
        name: "synthetic-provider-boundary",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            mocks[a.path] ? { path: a.path, namespace: "fixture" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: mocks[a.path],
            loader: "jsx",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const server = http.createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js"
        ? "application/javascript"
        : req.url === "/style.css"
          ? "text/css"
          : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? fs.readFileSync(out + "/bundle.js")
        : req.url === "/style.css"
          ? fs.readFileSync(out + "/style.css")
          : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-app text-text-strong"><div id="root"></div><script src="/bundle.js"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error("BROWSER", e.message);
      });
      await page.route("**/*", (r) =>
        new URL(r.request().url()).hostname === "127.0.0.1"
          ? r.continue()
          : r.abort(),
      );
      const url = `http://127.0.0.1:${server.address().port}`;
      await page.goto(url);
      await page.getByRole("link", { name: /Review add/ }).waitFor();
      assert.equal(
        await page.getByRole("link", { name: /Review add/ }).count(),
        1,
      );
      assert(
        await page
          .getByText("Shared approval setup is complete; delay is optional.", {
            exact: false,
          })
          .count(),
      );
      await page
        .getByText("Change rules (UpdateIntent): 1 of 1", { exact: true })
        .click();
      await page
        .getByText(/1 of 1 governance approvals required \(creator only\)/)
        .waitFor();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: out + `/checklist-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("link", { name: /Review add/ }).click();
      await page.getByText("Spending rule #3", { exact: true }).waitFor();
      const address = await page.evaluate(() => window.fixture.address);
      assert.equal(new URL(page.url()).searchParams.get("address"), address);
      assert(
        await page
          .locator("input")
          .evaluateAll((els, a) => els.some((el) => el.value === a), address),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page
        .getByPlaceholder("Sarah", { exact: true })
        .fill("Imported signer");
      await page.getByText("Review transaction", { exact: true }).waitFor();
      await page.waitForTimeout(350);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert(
        await page
          .locator("dd")
          .evaluateAll(
            (els, a) => els.some((el) => el.textContent === a),
            address,
          ),
      );
      await page.screenshot({
        path: out + `/import-review-${width}.png`,
        fullPage: true,
      });
      await page.goto(url + "/app/wallet/Synthetic/members/add?intent=99");
      await page
        .getByText("Selected rule unavailable", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("link", { name: "Enable sending", exact: true })
          .count(),
        0,
      );
      assert.equal(errors.length, 0, errors.join("\n"));
      await page.close();
      console.log(
        "PASS",
        width,
        "rule-specific roster, optional delay, exact imported draft, governance disclosure, invalid-rule gate, no overflow",
      );
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
