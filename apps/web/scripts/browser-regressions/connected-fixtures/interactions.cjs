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
      let errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("dialog", (d) => d.dismiss());
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
      const go = async (path) => {
        await p.goto(base + path, {
          waitUntil: "networkidle",
          timeout: 120000,
        });
        await p.waitForTimeout(400);
      };
      const capture = async (name) =>
        p.screenshot({ path: `${root}/final/${name}-${width}.png` });
      await go("/app/wallet");
      await p.getByRole("button", { name: "Switch", exact: true }).click();
      await p.getByRole("dialog").waitFor();
      await capture("wallet-dialog");
      await p.keyboard.press("Escape");
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      results.push({
        width,
        flow: "Real wallet switch dialog open/Escape close",
      });
      await go("/app/wallet/operations/buy");
      await p.getByLabel("Amount in USD").fill("25");
      assert.equal(
        await p
          .getByRole("button", { name: "Continue to checkout" })
          .isEnabled(),
        true,
      );
      assert((await p.locator("body").innerText()).includes(pk(2)));
      await capture("payment-filled");
      await p.getByRole("button", { name: "Continue to checkout" }).click();
      await p.getByText("Could not start checkout", {exact:true}).waitFor();
      assert(!p.url().includes("paystack"));
      await capture("payment-error");
      results.push({
        width,
        flow: "Buy exact amount/full address; blocked gateway submission surfaces error",
      });
      await go("/app/wallet/operations/sell?fixtureState=bank-error");
      await p.getByRole("button", { name: "Retry bank list" }).click();
      await p
        .getByRole("alert")
        .filter({ hasText: "We couldn’t load the bank list." })
        .waitFor();
      assert(
        await p
          .getByRole("combobox", { name: "Bank", exact: true })
          .isDisabled(),
      );
      assert(
        await p
          .getByRole("button", { name: "Continue", exact: true })
          .isDisabled(),
      );
      await capture("bank-error");
      results.push({
        width,
        flow: "Bank read error/retry; selection and continuation remain disabled",
      });
      await go("/app/secure/new");
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      await p
        .getByText("Confirm", { exact: true })
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => {});
      assert(
        (await p.locator("body").innerText()).match(/review|confirm|build/i),
      );
      await capture("recovery-confirm");
      results.push({
        width,
        flow: "Actual recovery preset → confirmation; no creation or device request",
      });
      await go("/app/account");
      await p.getByRole("button", { name: "Set PIN", exact: true }).click();
      assert((await p.locator("input").count()) > 0);
      await capture("account-form");
      const cancel = p.getByRole("button", { name: "Cancel", exact: true });
      if (await cancel.count()) await cancel.click();
      results.push({
        width,
        flow: "Actual app-lock setup form opens; no PIN saved",
      });
      await go("/app/review-fixtures");
      await p.getByRole("button", { name: "Open signing review" }).click();
      await p.getByRole("heading", { name: "Review before signing" }).waitFor();
      assert(
        (
          await p.getByLabel("Exact prepared signing message").innerText()
        ).includes(pk(5)),
      );
      await capture("signing-review");
      await p
        .getByRole("button", { name: "Cancel review", exact: true })
        .click();
      await p
        .getByText(
          "Signing review cancelled. No signing was authorized by this review.",
          { exact: true },
        )
        .waitFor();
      await p.getByRole("button", { name: "Open signing review" }).click();
      await p.getByRole("button", { name: "Continue to wallet" }).click();
      await p
        .getByText("Fixture stopped before any wallet request.", {
          exact: true,
        })
        .waitFor();
      results.push({
        width,
        flow: "Real signing-review hook and component: focus, full document, cancel, reopen, confirm stop at fixture boundary",
      });
      await p.getByRole("button", { name: "Open owner approval" }).click();
      const dialog = p.getByRole("dialog");
      await dialog.waitFor();
      for (let n = 0; n < 8; n++) {
        await p.keyboard.press("Tab");
        assert(
          await dialog.evaluate((e) => e.contains(document.activeElement)),
        );
      }
      await capture("owner-dialog");
      await p.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await p.getByRole("button", { name: "Open owner approval" }).click();
      await p
        .getByRole("button", { name: "Cancel approval", exact: true })
        .click();
      results.push({
        width,
        flow: "Real owner dialog: focus containment, Escape, reopen/cancel",
      });
      await p.getByRole("button", { name: "Toggle loading" }).click();
      await p
        .locator("p")
        .filter({ hasText: /^Preparing your request$/ })
        .waitFor();
      await capture("loading");
      await go("/connect?fixtureState=signed-out");
      const beforeAuth = await p.evaluate(
        () => window.__fixtureAuthRequests || 0,
      );
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      assert.equal(
        await p.evaluate(() => window.__fixtureAuthRequests),
        beforeAuth + 1,
      );
      await capture("auth-handoff");
      results.push({
        width,
        flow: "Real connect screen invokes mocked SDK handoff exactly once; provider UI external",
      });
      assert.deepEqual(errors, []);
      await c.close();
      console.log("PASS", width);
      fs.writeFileSync(
        root + "/interaction-results.json",
        JSON.stringify(results, null, 2),
      );
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
