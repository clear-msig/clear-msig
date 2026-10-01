import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBundleManifest,
  DEFAULT_BUNDLE_BUDGETS,
  MAIN_DEVNET_BUDGETS,
  REVIEW_PREVIEW_BUDGETS,
  selectBundleBudgets,
  evaluateBundleBudgets,
  includeImmediateRuntimeChunks,
} from "./check-bundle-budgets.mjs";

test("separates shared and route-owned chunks without double counting", () => {
  const sizes = new Map([
    ["shared.js", 10],
    ["a.js", 5],
    ["b.js", 7],
  ]);
  const routes = analyzeBundleManifest(
    {
      pages: {
        "/app/a/page": ["shared.js", "a.js", "a.js"],
        "/app/b/page": ["shared.js", "b.js"],
      },
    },
    (file) => sizes.get(file) ?? 0,
  );

  assert.deepEqual(routes[0], {
    route: "/app/a/page",
    files: ["shared.js", "a.js"],
    sharedFiles: ["shared.js"],
    routeFiles: ["a.js"],
    sharedBytes: 10,
    routeBytes: 5,
    totalBytes: 15,
  });
  assert.equal(routes[1].totalBytes, 17);
  assert.equal(routes[1].sharedBytes + routes[1].routeBytes, routes[1].totalBytes);
});

test("counts immediately mounted dynamic runtime chunks once per route", () => {
  const manifest = includeImmediateRuntimeChunks(
    {
      pages: {
        "/app/a/page": ["shared.js", "route-a.js"],
        "/public/page": ["shared.js"],
      },
    },
    {
      "providers -> wallet": {
        files: ["shared.js", "wallet.js", "wallet.js"],
      },
    },
    [{ routePrefix: "/app/", loadableKey: "providers -> wallet" }],
  );

  assert.deepEqual(manifest.pages["/app/a/page"], [
    "shared.js",
    "route-a.js",
    "wallet.js",
  ]);
  assert.deepEqual(manifest.pages["/public/page"], ["shared.js"]);
});

test("keeps WaaS, Turnkey, and external runtimes in separate route profiles", () => {
  const base = { pages: { "/app/a/page": ["route.js"] } };
  const loadables = {
    waas: { files: ["core.js", "waas.js"] },
    turnkey: { files: ["core.js", "turnkey.js"] },
    external: { files: ["core.js", "external.js"] },
  };
  const waas = includeImmediateRuntimeChunks(base, loadables, [
    { routePrefix: "/app/", loadableKey: "waas" },
  ]);
  const turnkey = includeImmediateRuntimeChunks(base, loadables, [
    { routePrefix: "/app/", loadableKey: "turnkey" },
  ]);
  const external = includeImmediateRuntimeChunks(base, loadables, [
    { routePrefix: "/app/", loadableKey: "external" },
  ]);

  assert.deepEqual(waas.pages["/app/a/page"], [
    "route.js",
    "core.js",
    "waas.js",
  ]);
  assert.deepEqual(turnkey.pages["/app/a/page"], [
    "route.js",
    "core.js",
    "turnkey.js",
  ]);
  assert.deepEqual(external.pages["/app/a/page"], [
    "route.js",
    "core.js",
    "external.js",
  ]);
});

const approvedPreview = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "review/security-ux-audit-2026-09-30",
};

test("selects the named baseline only for the approved review preview", () => {
  assert.equal(selectBundleBudgets(approvedPreview), REVIEW_PREVIEW_BUDGETS);
  assert.equal(selectBundleBudgets({ ...approvedPreview, VERCEL_TARGET_ENV: "preview" }), REVIEW_PREVIEW_BUDGETS);
  assert.equal(REVIEW_PREVIEW_BUDGETS.id, "review-preview-2026-10-01-v1");
  assert.deepEqual(DEFAULT_BUNDLE_BUDGETS, {
    id: "production-ratchet-2026-07-16", app: 971, external: 1100, turnkey: 954, chunk: 506,
  });
});

test("production, custom environments and unrelated branches retain original limits", () => {
  for (const overrides of [
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL_ENV: "staging" }, { VERCEL_TARGET_ENV: "production" },
    { VERCEL_TARGET_ENV: "staging" }, { VERCEL_TARGET_ENV: "" },
    { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_REF: "review/security-ux-audit-2026-09-30-copy" },
    { VERCEL: "0" },
  ]) assert.equal(selectBundleBudgets({ ...approvedPreview, ...overrides }), DEFAULT_BUNDLE_BUDGETS);
});

test("missing or malformed scope metadata fails closed to original limits", () => {
  assert.equal(selectBundleBudgets(), DEFAULT_BUNDLE_BUDGETS);
  for (const key of Object.keys(approvedPreview)) {
    for (const value of [undefined, "", " ", true, 1]) {
      assert.equal(selectBundleBudgets({ ...approvedPreview, [key]: value }), DEFAULT_BUNDLE_BUDGETS);
    }
  }
  assert.equal(selectBundleBudgets({ BUNDLE_BUDGET_KB: "999999", VERCEL_ENV: "preview" }), DEFAULT_BUNDLE_BUDGETS);
});

function metrics() {
  return { routeSizes: [], externalAppSizes: [], turnkeyAppSizes: [], chunks: new Map() };
}
function row(route, totalBytes, routeBytes = 0) {
  return { route, totalBytes, routeBytes };
}

test("the exact measured secured runtime passes preview and fails default budgets", () => {
  const actual = {
    routeSizes: [row("/app/wallet/[name]/agents/page", 1022438)],
    externalAppSizes: [row("/app/wallet/[name]/agents/page", 1150377)],
    turnkeyAppSizes: [row("/app/wallet/[name]/agents/page", 1014102)],
    chunks: new Map([["sdk.js", 530226]]),
  };
  assert.deepEqual(evaluateBundleBudgets(actual, selectBundleBudgets(approvedPreview)), []);
  assert.equal(evaluateBundleBudgets(actual).length, 4);
});

test("each preview ceiling permits the boundary and rejects one extra byte", () => {
  for (const [field, budget] of [
    ["routeSizes", "app"], ["externalAppSizes", "external"], ["turnkeyAppSizes", "turnkey"],
  ]) {
    const value = REVIEW_PREVIEW_BUDGETS[budget] * 1024;
    const sample = metrics();
    sample[field] = [row("/app/example/page", value)];
    assert.deepEqual(evaluateBundleBudgets(sample, REVIEW_PREVIEW_BUDGETS), []);
    sample[field][0].totalBytes++;
    assert.equal(evaluateBundleBudgets(sample, REVIEW_PREVIEW_BUDGETS).length, 1);
  }
  const sample = metrics();
  sample.chunks.set("runtime.js", 518 * 1024);
  assert.deepEqual(evaluateBundleBudgets(sample, REVIEW_PREVIEW_BUDGETS), []);
  sample.chunks.set("runtime.js", 518 * 1024 + 1);
  assert.equal(evaluateBundleBudgets(sample, REVIEW_PREVIEW_BUDGETS).length, 1);
});

test("preview never widens public, connect or route-owned budgets", () => {
  for (const [route, total, owned] of [
    ["/page", 260 * 1024 + 1, 0],
    ["/connect/page", 1100 * 1024 + 1, 0],
    ["/page", 200 * 1024, 180 * 1024 + 1],
    ["/connect/page", 500 * 1024, 230 * 1024 + 1],
    ["/app/example/page", 500 * 1024, 230 * 1024 + 1],
  ]) {
    const sample = metrics();
    sample.routeSizes = [row(route, total, owned)];
    assert.equal(evaluateBundleBudgets(sample, REVIEW_PREVIEW_BUDGETS).length, 1);
    assert.deepEqual(evaluateBundleBudgets(sample, REVIEW_PREVIEW_BUDGETS), evaluateBundleBudgets(sample));
  }
});

const approvedMain = {
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_GIT_REPO_OWNER: "clear-msig", VERCEL_GIT_REPO_SLUG: "clear-msig",
};
const approvedMainCi = {
  GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "clear-msig/clear-msig",
  GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main",
};
test("approved main devnet Vercel and push CI use exactly the measured preview ceilings", () => {
  for (const env of [approvedMain, {...approvedMain, VERCEL_TARGET_ENV: "production"}, approvedMainCi])
    assert.equal(selectBundleBudgets(env), MAIN_DEVNET_BUDGETS);
  assert.deepEqual(MAIN_DEVNET_BUDGETS, {...REVIEW_PREVIEW_BUDGETS, id: "main-devnet-2026-10-01-v1"});
});
test("main baseline requires exact platform, repository, branch and event metadata", () => {
  for (const env of [approvedMain, approvedMainCi]) {
    for (const key of Object.keys(env)) {
      for (const value of [undefined, "", " ", true, 1, "other"])
        assert.equal(selectBundleBudgets({...env, [key]: value}), DEFAULT_BUNDLE_BUDGETS);
    }
  }
  for (const VERCEL_TARGET_ENV of ["preview", "staging", "", "mainnet"])
    assert.equal(selectBundleBudgets({...approvedMain, VERCEL_TARGET_ENV}), DEFAULT_BUNDLE_BUDGETS);
  assert.equal(selectBundleBudgets({...approvedMainCi, VERCEL: "0"}), DEFAULT_BUNDLE_BUDGETS);
  assert.equal(selectBundleBudgets({...approvedMainCi, GITHUB_EVENT_NAME: "pull_request"}), DEFAULT_BUNDLE_BUDGETS);
});
test("main devnet ceilings still reject one byte of growth in every measured profile", () => {
  for (const [field, budget] of [["routeSizes", "app"], ["externalAppSizes", "external"], ["turnkeyAppSizes", "turnkey"]]) {
    const sample = metrics();
    sample[field] = [row("/app/example/page", MAIN_DEVNET_BUDGETS[budget] * 1024)];
    assert.deepEqual(evaluateBundleBudgets(sample, MAIN_DEVNET_BUDGETS), []);
    sample[field][0].totalBytes++;
    assert.equal(evaluateBundleBudgets(sample, MAIN_DEVNET_BUDGETS).length, 1);
  }
  const sample = metrics();
  sample.chunks.set("runtime.js", MAIN_DEVNET_BUDGETS.chunk * 1024 + 1);
  assert.equal(evaluateBundleBudgets(sample, MAIN_DEVNET_BUDGETS).length, 1);
});
