const { chromium } = require("playwright"),
  assert = require("assert/strict"),
  fs = require("fs");
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const colorScheme of ["light", "dark"]) {
      const c = await b.newContext({
        viewport: { width: 390, height: 500 },
        colorScheme,
        reducedMotion: "reduce",
      });
      const p = await c.newPage();
      await p.route("**/*", (r) => {
        const u = new URL(r.request().url());
        if (
          u.origin !==
          (process.env.CLEARSIG_REVIEW_URL || "http://127.0.0.1:3106")
        )
          return r.abort();
        if (u.pathname.startsWith("/api/"))
          return r.fulfill({ status: 503, body: "{}" });
        return r.continue();
      });
      await p.routeWebSocket(/.*/, (w) => w.close());
      await p.goto(
        (process.env.CLEARSIG_REVIEW_URL || "http://127.0.0.1:3106") +
          "/app/review-fixtures",
        { waitUntil: "networkidle" },
      );
      await p
        .getByRole("button", { name: "Open signing review", exact: true })
        .click();
      const confirm = p.getByRole("button", {
        name: "Continue to wallet",
        exact: true,
      });
      await confirm.scrollIntoViewIfNeeded();
      await p.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const box = await confirm.boundingBox();
      const nav = await p
        .getByRole("navigation", { name: "Primary", exact: true })
        .boundingBox();
      assert(
        box && nav && box.y + box.height <= nav.y,
        JSON.stringify({ box, nav }),
      );
      assert(
        await confirm.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return e.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
      );
      await p.screenshot({
        path: `${process.env.CLEARSIG_REVIEW_OUTPUT || "/tmp/clearsig-expanded-evidence"}/captures/signing-clearance-390-500-${colorScheme}.png`,
      });
      results.push({
        colorScheme,
        width: 390,
        height: 500,
        flow: "Real signing-review final action clear of navigation and hit-testable at scroll end",
      });
      await c.close();
    }
    fs.writeFileSync(
      (process.env.CLEARSIG_REVIEW_OUTPUT ||
        "/tmp/clearsig-expanded-evidence") + "/signing-clearance-results.json",
      JSON.stringify(results, null, 2),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
