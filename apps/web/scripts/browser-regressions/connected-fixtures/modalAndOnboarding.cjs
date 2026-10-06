const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const out =
    process.env.CLEARSIG_REVIEW_OUTPUT || "/tmp/clearsig-expanded-evidence",
  base = process.env.CLEARSIG_REVIEW_URL || "http://127.0.0.1:3106";
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const theme of ["light", "dark"])
      for (const width of [390, 1440]) {
        const c = await b.newContext({
          viewport: { width, height: 844 },
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        const p = await c.newPage();
        let errors = [];
        p.on("pageerror", (e) => errors.push(e.stack));
        await p.route("**/*", (r) => {
          const u = new URL(r.request().url());
          if (u.origin !== base) return r.abort();
          if (u.pathname.startsWith("/api/"))
            return r.fulfill({ status: 503, body: "{}" });
          return r.continue();
        });
        await p.routeWebSocket(/.*/, (w) => w.close());
        await p.goto(base + "/app/review-fixtures", {
          waitUntil: "networkidle",
        });
        const opener = p.getByRole("button", {
          name: "Open owner approval",
          exact: true,
        });
        await opener.click();
        await p.getByRole("dialog").waitFor();
        assert(await p.locator(".app-experience").evaluate((e) => e.inert));
        const original = p.url();
        const point = { x: 35, y: width === 390 ? 815 : 200 };
        assert(
          await p.evaluate(
            ({ x, y }) =>
              !!document
                .elementFromPoint(x, y)
                ?.closest("[data-owner-approval-overlay]"),
            point,
          ),
        );
        await p.mouse.click(point.x, point.y);
        assert.equal(p.url(), original);
        assert(await p.getByRole("dialog").isVisible());
        for (let i = 0; i < 8; i++) {
          await p.keyboard.press("Tab");
          assert(
            await p
              .getByRole("dialog")
              .evaluate((d) => d.contains(document.activeElement)),
          );
        }
        await p.screenshot({
          path: out + `/captures/owner-layer-${width}-${theme}.png`,
        });
        await p.evaluate(() => {
          const button = document.createElement("button");
          button.id = "provider-boundary-probe";
          button.textContent = "Fixture overlay probe";
          button.style.cssText = "position:fixed;right:0;top:0;z-index:10000";
          button.onclick = () => {
            window.__providerProbeClicked = true;
          };
          document.body.appendChild(button);
        });
        await p.locator("#provider-boundary-probe").click();
        assert(await p.evaluate(() => window.__providerProbeClicked));
        await p.locator("#provider-boundary-probe").evaluate((e) => e.remove());
        await p.keyboard.press("Escape");
        await p.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(
          await p.locator(".app-experience").evaluate((e) => e.inert),
          false,
        );
        assert(await opener.evaluate((e) => document.activeElement === e));
        results.push({
          theme,
          width,
          flow: "Owner approval dims whole shell; inert background/pointer block, keyboard loop, focus restore; outside-shell overlay probe remains usable",
        });
        await p.goto(base + "/app/wallet/new", { waitUntil: "networkidle" });
        await p
          .getByRole("heading", { name: "Create a personal wallet" })
          .waitFor();
        if (width === 390)
          assert.equal(
            await p
              .getByRole("link", { name: "Create a new wallet", exact: true })
              .count(),
            0,
          );
        for (const height of width === 390 ? [844, 500] : [844]) {
          await p.setViewportSize({ width, height });
          const button = p.getByRole("button", { name: /Create My wallet/i });
          await button.scrollIntoViewIfNeeded();
          await p.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const main = document.querySelector(".app-content-stage");
            if (main) main.scrollTop = main.scrollHeight;
          });
          await p.waitForTimeout(100);
          const box = await button.boundingBox();
          assert(
            box && box.y >= 0 && box.y + box.height <= height,
            JSON.stringify(box),
          );
          assert(
            await button.evaluate((e) => {
              const r = e.getBoundingClientRect();
              return e.contains(
                document.elementFromPoint(
                  r.x + r.width / 2,
                  r.y + r.height / 2,
                ),
              );
            }),
          );
          if (width === 390) {
            const nav = await p
              .getByRole("navigation", { name: "Primary", exact: true })
              .boundingBox();
            assert(box.y + box.height <= nav.y, JSON.stringify({ box, nav }));
          }
          await p.screenshot({
            path:
              out +
              `/captures/onboarding-clearance-${width}-${height}-${theme}.png`,
          });
          results.push({
            theme,
            width,
            height,
            flow: "Onboarding primary CTA visible/hit-testable at scroll end; redundant floating create button absent",
          });
        }
        assert.deepEqual(errors, []);
        await c.close();
      }
    fs.writeFileSync(
      out + "/blocker-results.json",
      JSON.stringify(results, null, 2),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
