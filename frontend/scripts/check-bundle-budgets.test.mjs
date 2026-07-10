import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBundleManifest,
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
