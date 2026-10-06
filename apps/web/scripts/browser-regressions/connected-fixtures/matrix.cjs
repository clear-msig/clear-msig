// Test-only provider-boundary UI evidence. All external requests and writes are blocked.
const { chromium } = require("playwright"),
  fs = require("fs"),
  assert = require("assert/strict");
const { PublicKey } = require("@solana/web3.js");
const pk = (n) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const root =
    process.env.CLEARSIG_REVIEW_OUTPUT || "/workspace/scratch/app-wide-review",
  base = process.env.CLEARSIG_REVIEW_URL || "http://127.0.0.1:3105";
const ready = [
  ["dashboard", "/app/wallet"],
  ["wallet", "/app/wallet/operations"],
  [
    "send",
    "/app/wallet/operations/send?asset=solana&amount=0.3&recipient=" + pk(5),
  ],
  ["payments", "/app/wallet/operations/buy"],
  ["sell", "/app/wallet/operations/sell"],
  ["proposal", "/app/proposals/" + pk(4)],
  ["recovery", "/app/secure"],
  ["recovery-new", "/app/secure/new"],
  ["agents", "/app/wallet/operations/agents"],
  ["settings", "/app/settings"],
  ["activity", "/app/activity"],
  ["onboarding", "/app/wallet/new"],
  ["treasury", "/app/wallet/operations/recurring"],
  ["members", "/app/wallet/operations/members"],
  ["contacts", "/app/contacts"],
  ["account", "/app/account"],
  ["notifications", "/app/notifications"],
  ["auth", "/connect?fixtureState=signed-out"],
];
const states = [
  ["dashboard-empty", "/app/wallet?fixtureState=empty"],
  ["dashboard-loading", "/app/wallet?fixtureState=loading"],
  ["dashboard-error", "/app/wallet?fixtureState=error"],
  ["bank-error", "/app/wallet/operations/sell?fixtureState=bank-error"],
  ["bank-empty", "/app/wallet/operations/sell?fixtureState=bank-empty"],
  ["review-error", "/app/proposals/" + pk(4) + "?fixtureState=review-error"],
  [
    "review-loading",
    "/app/proposals/" + pk(4) + "?fixtureState=review-loading",
  ],
  ["activity-empty", "/app/activity?fixtureState=empty"],
];
(async () => {
  fs.mkdirSync(root + "/final", { recursive: true });
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const width of [390, 1440]) {
      const c = await b.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: "reduce",
      });
      await c.addInitScript(() => {
        navigator.credentials.create = async () => {
          throw new Error("Fixture blocks device creation");
        };
        navigator.credentials.get = async () => {
          throw new Error("Fixture blocks device access");
        };
        window.open = () => null;
      });
      const p = await c.newPage();
      await p.route("**/*", (r) => {
        const u = new URL(r.request().url());
        if (u.origin !== base) return r.abort();
        if (u.pathname.startsWith("/api/") || u.pathname === "/fixture-rpc")
          return r.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"error":"Local fixture blocks network operations"}',
          });
        return r.continue();
      });
      await p.routeWebSocket(/.*/, (ws) => ws.close());
      for (const [family, route] of [...ready, ...states].filter(([family]) => !process.env.CLEARSIG_REVIEW_FAMILY || family === process.env.CLEARSIG_REVIEW_FAMILY)) {
        let errors = [];
        const error = (e) => errors.push(e.message),
          consoleError = (m) => {
            if (m.type() === "error" && m.text().includes("[error-boundary]"))
              errors.push(m.text());
          };
        p.on("pageerror", error);
        p.on("console", consoleError);
        await p.goto(base + route, {
          waitUntil: "networkidle",
          timeout: 120000,
        });
        await p.waitForTimeout(900);
        if (family === "send") await p.getByRole("region", {name:"Review transaction"}).waitFor();
        if (family === "agents") await p.getByText("Advanced", {exact:true}).waitFor();
        const text = await p.locator("body").innerText();
        const overflow = await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        await p.screenshot({ path: `${root}/final/${family}-${width}.png` });
        results.push({
          family,
          route,
          width,
          url: p.url(),
          errors,
          overflow,
          text,
          keys: await p.evaluate(() => window.__fixtureQueryKeys),
        });
        fs.writeFileSync(
          root + "/matrix-results.json",
          JSON.stringify(results, null, 2),
        );
        console.log(
          family,
          width,
          errors.length,
          overflow
            ? "OVERFLOW"
            : text.includes("Something went wrong")
              ? "BOUNDARY"
              : "rendered",
        );
        p.off("pageerror", error);
        p.off("console", consoleError);
      }
      await c.close();
    }
    const failures = results.filter(
      (x) =>
        x.errors.length ||
        x.overflow ||
        x.text.includes("Something went wrong"),
    );
    assert.equal(
      failures.length,
      0,
      JSON.stringify(
        failures.map((x) => ({
          family: x.family,
          width: x.width,
          errors: x.errors,
        })),
        null,
        2,
      ),
    );
    console.log("ALL", results.length, "PASS");
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
