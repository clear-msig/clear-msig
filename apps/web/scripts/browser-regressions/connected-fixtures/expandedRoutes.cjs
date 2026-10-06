const fs = require("node:fs"),
  { chromium } = require("playwright"),
  { storage, pk } = require("./expandedSeed.cjs");
const base = process.env.CLEARSIG_REVIEW_URL || "http://127.0.0.1:3106",
  out = process.env.CLEARSIG_REVIEW_OUTPUT || "/tmp/clearsig-expanded-evidence";
fs.mkdirSync(out + "/captures", { recursive: true });
const inventory = fs.readFileSync(
  require("node:path").resolve(
    __dirname,
    "../../../../..",
    "docs/review/app-route-implementation-map-2026-10-06.md",
  ),
  "utf8",
);
const rows = [...inventory.matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gm)].map(
  (m, i) => ({
    id: "r" + String(i + 1).padStart(2, "0"),
    route: m[1],
    family: m[2].trim(),
  }),
);
const cases = process.env.REVIEW_IDS
  ? rows.filter((r) => process.env.REVIEW_IDS.split(",").includes(r.id))
  : rows;
(async () => {
  const b = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    await Promise.all(
      (process.env.REVIEW_WIDTHS || "390,1440")
        .split(",")
        .map(Number)
        .map(async (width) => {
          const c = await b.newContext({
            viewport: { width, height: 1000 },
            colorScheme: "dark",
            reducedMotion: "reduce",
          });
          await c.addInitScript((storage) => {
            for (const [k, v] of Object.entries(storage))
              localStorage.setItem(k, v);
            navigator.credentials.create = async () => {
              throw new Error("Fixture blocks device");
            };
            navigator.credentials.get = async () => {
              throw new Error("Fixture blocks device");
            };
            window.open = () => null;
          }, storage);
          const p = await c.newPage();
          await p.route("**/*", (r) => {
            const u = new URL(r.request().url());
            if (u.origin !== base) return r.abort();
            if (u.pathname.startsWith("/api/") || u.pathname === "/fixture-rpc")
              return r.fulfill({
                status: 503,
                contentType: "application/json",
                body: '{"error":"Synthetic local review blocks API requests"}',
              });
            return r.continue();
          });
          await p.routeWebSocket(/.*/, (w) => w.close());
          for (const row of cases) {
            const errors = [],
              failures = [];
            const onError = (e) =>
              errors.push({ message: e.message, stack: e.stack });
            const onFailed = (r) => {
              if (r.resourceType() === "script")
                failures.push({ url: r.url(), error: r.failure() });
            };
            const onConsole = (m) => {
              if (m.type() === "error" && m.text().includes("[error-boundary]"))
                errors.push({ message: m.text() });
            };
            p.on("console", onConsole);
            p.on("pageerror", onError);
            p.on("requestfailed", onFailed);
            let path = row.route
              .replace("[name]", "operations")
              .replace("[proposal]", pk(4))
              .replace("[recovery]", pk(7))
              .replace("[agent]", "review-trader")
              .replace("[slug]", "review-trader")
              .replace(
                "[id]",
                row.route.includes("policies")
                  ? "review-policy"
                  : "review-notification",
              );
            const publicPage =
              !row.route.startsWith("/app") && !row.route.startsWith("/send");
            const query = new URLSearchParams({
              fixtureState: publicPage
                ? "signed-out"
                : process.env.REVIEW_STATE || "expanded",
            });
            if (path.startsWith("/send")) query.set("wallet", "operations");
            if (row.id === "r27") query.set("debug", "1");
            try {
              await p.goto(base + path + "?" + query, {
                waitUntil: "networkidle",
                timeout: 120000,
              });
              await p.waitForFunction(
                (minimumText) => {
                  const main = document.querySelector("main");
                  return (
                    (main?.innerText?.trim().length ?? 0) > minimumText ||
                    (!main && document.body.innerText.trim().length > 300)
                  );
                },
                process.env.REVIEW_STATE === "setup" ? 40 : 90,
                { timeout: 25000 },
              );
              await p.waitForTimeout(300);
              if (
                ["/app", "/app/intents", "/app/proposals"].includes(row.route)
              )
                await p.waitForURL(
                  (u) => u.pathname === "/app/wallet/operations",
                  {
                    timeout: 20000,
                  },
                );
              if (row.route.startsWith("/send"))
                await p.waitForURL(
                  (u) => u.pathname.startsWith("/app/wallet/operations/send"),
                  { timeout: 20000 },
                );
              if (row.route.endsWith("/agents"))
                await p
                  .getByText("Advanced", { exact: true })
                  .waitFor({ timeout: 10000 })
                  .catch(() => {});
              if (["r62", "r84"].includes(row.id)) {
                await p
                  .getByRole("navigation", { name: "Choose what to send" })
                  .getByRole("link", { name: /Solana/ })
                  .click();
                await p
                  .getByRole("region", { name: "Review transaction" })
                  .waitFor({ timeout: 30000 });
              }
              if (row.id === "r48" && width <= 390) {
                const widths = await p
                  .locator("[data-member-identity]")
                  .evaluateAll((nodes) =>
                    nodes.map((node) => node.getBoundingClientRect().width),
                  );
                if (widths.length !== 3 || widths.some((value) => value < 200))
                  throw new Error(
                    "Member identity is squeezed by action controls",
                  );
              }
              if (row.id === "r31") {
                await p
                  .getByText(
                    "Positions unavailable. Check the connection before relying on this account view.",
                    { exact: true },
                  )
                  .waitFor();
                await p.getByText("Not ready", { exact: true }).waitFor();
              }
              const text = await p.locator("body").innerText();
              const overflow = await p.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              );
              const capture = out + `/captures/${row.id}-${width}-dark.png`;
              await p.screenshot({ path: capture, fullPage: true });
              const current = {
                ...row,
                width,
                theme: "dark",
                url: p.url(),
                overflow,
                errors,
                scriptFailures: failures,
                text,
                queryKeys: await p.evaluate(
                  () => window.__fixtureQueryKeys ?? [],
                ),
                capture,
              };
              results.push(current);
              console.log(
                row.id,
                width,
                row.route,
                overflow ? "OVERFLOW" : "fit",
                errors.length ? "ERROR" : "rendered",
                new URL(p.url()).pathname !== path ? "REDIRECT" : "",
              );
            } catch (e) {
              results.push({
                ...row,
                width,
                error: String(e),
                errors,
                scriptFailures: failures,
              });
              console.log("FAILED", row.id, width, String(e));
            } finally {
              p.off("console", onConsole);
              p.off("pageerror", onError);
              p.off("requestfailed", onFailed);
              fs.writeFileSync(
                out +
                  (process.env.REVIEW_STATE === "setup"
                    ? "/setup-results.json"
                    : process.env.REVIEW_IDS
                      ? "/focused-results.json"
                      : "/route-results.json"),
                JSON.stringify(results, null, 2),
              );
            }
          }
          await c.close();
        }),
    );
    const failed = results.filter(
      (row) =>
        row.error ||
        row.errors?.length ||
        row.overflow ||
        row.scriptFailures?.length ||
        row.text?.includes("Something went wrong") ||
        row.text?.includes("THIS DEPLOYMENT IS MISCONFIGURED"),
    );
    if (failed.length)
      throw new Error(
        JSON.stringify(
          failed.map((row) => ({
            id: row.id,
            width: row.width,
            error: row.error,
            errors: row.errors,
          })),
          null,
          2,
        ),
      );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
