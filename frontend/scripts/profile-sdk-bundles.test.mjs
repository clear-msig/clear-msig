import assert from "node:assert/strict";
import test from "node:test";

import { profileSdkModules } from "./profile-sdk-bundles.mjs";

test("attributes SDK leaf modules to each route chunk without counting containers", () => {
  const rows = profileSdkModules(
    {
      chunks: [
        { id: 1, files: ["static/a.js"] },
        { id: 2, files: ["static/wallet.js"] },
      ],
      modules: [
        {
          name: "container",
          size: 999,
          modules: [
            {
              name: "./node_modules/@solana/web3.js/lib/index.js",
              size: 120,
              chunks: [1],
            },
            {
              name: "./node_modules/@dynamic-labs/sdk/index.js",
              size: 80,
              chunks: [2],
            },
          ],
        },
      ],
    },
    { pages: { "/app/a/page": ["static/a.js"] } },
    { [EMBEDDED_KEY]: { files: ["static/wallet.js"] } },
  );

  assert.equal(rows[0].families["Solana Web3"], 120);
  assert.equal(rows[0].families.Dynamic, 80);
});

const EMBEDDED_KEY =
  "components/providers/AppProviders.tsx -> @/features/wallet-runtime/infrastructure/EmbeddedDynamicProviderTree";

test("fails when runtime measurement metadata is stale", () => {
  assert.throws(
    () => profileSdkModules({ chunks: [], modules: [] }, { pages: {} }, {}),
    /could not find wallet runtime/,
  );
});
