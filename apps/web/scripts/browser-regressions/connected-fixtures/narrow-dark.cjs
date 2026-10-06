// Test-only provider-boundary UI evidence. All external requests and writes are blocked.
const { chromium } = require("playwright"),
  fs = require("fs"),
  assert = require("assert/strict");
const { PublicKey } = require("@solana/web3.js");
const pk = (n) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const root =
    process.env.CLEARSIG_REVIEW_OUTPUT || "/workspace/scratch/app-wide-review",
  base = process.env.CLEARSIG_REVIEW_URL || "http://127.0.0.1:3105";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  let rows = [];
  try {
    for (const [width, colorScheme] of [
      [320, "light"],
      [390, "dark"],
    ]) {
      const c = await b.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        reducedMotion: "reduce",
      });
      const p = await c.newPage();
      await p.route("**/*", (r) => {
        const u = new URL(r.request().url());
        return u.origin !== base
          ? r.abort()
          : u.pathname.startsWith("/api/") || u.pathname === "/fixture-rpc"
            ? r.fulfill({
                status: 503,
                contentType: "application/json",
                body: '{"error":"Fixture blocked"}',
              })
            : r.continue();
      });
      await p.routeWebSocket(/.*/, (ws) => ws.close());
      let errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      for (const [name, path] of [
        [
          "send",
          "/app/wallet/operations/send?asset=solana&amount=0.3&recipient=" +
            pk(5),
        ],
        ["payments", "/app/wallet/operations/buy"],
        ["proposal", "/app/proposals/" + pk(4)],
        ["recovery", "/app/secure/new"],
        ["agents", "/app/wallet/operations/agents"],
        ["account", "/app/account"],
      ]) {
        await p.goto(base + path, {
          waitUntil: "networkidle",
          timeout: 120000,
        });
        await p.waitForTimeout(600);
        if (name === "agents") await p.getByText("Advanced", {exact:true}).waitFor();
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert(
          !(await p.locator("body").innerText()).includes(
            "Something went wrong",
          ),
        );
        if (name === "payments") {
          assert((await p.getByText(pk(2), { exact: true }).count()) > 0);
          assert(
            (
              await p
                .getByRole("button", { name: "Continue to checkout" })
                .boundingBox()
            ).height >= 44,
          );
        }
        let ratio = null;
        if (name === "proposal") {
          ratio = await p
            .getByText("Waiting for approval", { exact: true })
            .first()
            .evaluate((e) => {
              const fg = getComputedStyle(e)
                  .color.match(/[\d.]+/g)
                  .slice(0, 3)
                  .map(Number),
                bg = getComputedStyle(document.documentElement)
                  .getPropertyValue("--clear-canvas-rgb")
                  .trim()
                  .split(/\s+/)
                  .map(Number);
              const lum = (a) =>
                a
                  .map((v) => {
                    v /= 255;
                    return v <= 0.04045
                      ? v / 12.92
                      : ((v + 0.055) / 1.055) ** 2.4;
                  })
                  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
              const x = lum(fg),
                y = lum(bg);
              return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            });
          assert(ratio >= 4.5);
        }
        await p.screenshot({
          path: `${root}/final/${name}-${width}-${colorScheme}.png`,
        });
        rows.push({
          name,
          width,
          colorScheme,
          statusContrast: ratio,
          overflow: false,
        });
        console.log(name, width, colorScheme);
      }
      assert.deepEqual(errors, []);
      await c.close();
    }
    fs.writeFileSync(
      root + "/narrow-dark-results.json",
      JSON.stringify(rows, null, 2),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
