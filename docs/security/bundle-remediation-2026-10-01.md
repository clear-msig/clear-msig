# Bundle remediation: measured dependency consolidation

Starting point: published review commit `f54462e14ccf8727d6ef3504e9501ac7aa70cc12`.
The supplied Vercel failure tail confirms the bundle gate, not a compile or test failure.
This follow-up is a partial performance improvement; it does not make the build releasable.

## Retained changes

- Pin the existing Dynamic v4 logger at the application dependency root. npm removed
  15 nested v4 logger instances. Consumers requiring v5 still resolve 5.9.2 at
  their own compatible dependency boundary. No logger implementation/version was
  replaced for a consumer. The old emitted graph had 12 identical v4 logger entry
  modules. Logger global state already uses `Symbol.for` on `globalThis`; shared
  configuration remains shared, and per-instance names/levels remain separate.
- Map only Yup's five public Lodash function imports to same-version Lodash ESM
  entries already used by Formik: has, snakeCase, camelCase, mapKeys, mapValues.
  Both packages remain 4.18.1. This is browser-only, exact-entry resolution, not a
  global package substitution. It saves 6,074 gzip bytes in the shared SDK chunk.
  Server resolution is unchanged. No SDK private imports or crypto aliases.

## Measurements

Normal unchanged gzip accounting includes the selected immediate wallet runtime.
No chunk splitting, budget changes, skipped signing code or connector removal.

| Measurement (kB gzip) | Published | Consolidated | Budget |
| --- | ---: | ---: | ---: |
| Largest chunk | 535.7 | 517.8 | 506 |
| Largest standard authenticated route | 1020.6 | 998.5 | 971 |
| Largest external-wallet route | 1149.5 | 1123.4 | 1100 |
| Largest legacy Turnkey route | 1010.4 | 990.3 | 954 |

The final largest chunk is `static/chunks/3975.173ec998305e2df2.js`,
530,226 gzip bytes, versus 548,593 before. Its inherited Webpack module membership
contains **zero application source modules**. Moving application helpers into
lazy routes cannot itself remove that remaining 11.8 kB chunk overage.
The remaining total-runtime overages are 27.5 / 23.4 / 36.3 kB respectively.

The original supplied base used Dynamic 4.92.3 and Next 15.5.20; the secured review
uses 4.100.3 and 15.5.27. Those security updates remain. No fresh old/vulnerable
base build was performed. Earlier baseline measurements are recorded in the
browser-review report; this pass profiles the actual published review source.

## Other investigated contributors

- Most purported duplicate noble/cross-fetch package instances are not duplicated
  in the emitted browser graph. The emitted distinct curves versions belong to
  incompatible consumer requirements. No global crypto resolution override.
- Generated SDK API clients 0.16.0 and 0.40.0 are both substantial, but their
  incompatible contracts cannot be collapsed by a version alias.
- SDK ESM entrypoints are being selected, not an accidental second CJS SDK graph.
- An offline default-safe Terser three-pass experiment on the already-minified SDK
  chunk saved only 515 bytes. No extra minifier/configuration retained.
- Existing application boundaries already defer Ledger transport, price feed,
  sidebar, command palette and notifications. Framer Motion's shared runtime
  supports existing layout animation; deleting it changes behavior. Deferring
  an immediately used provider/animation engine would conceal first-load cost,
  not remove complete-runtime cost, and was not used to satisfy the check.

## Validation

- Production compile: pass, 50 pages, opt-in complete Webpack module profiling.
- `npm run verify` under NODE_ENV=production / VERCEL=1 / preview: **222 suites,
  1,727 tests plus 14 script tests pass**; metadata, intent registry, architecture,
  ESLint and TypeScript pass. Six real temporary Redis cases included.
- Eight new resolution/behavior tests exercise actual browser aliases, exact
  logger consumer resolution, shared configuration, separate instance names and
  levels, inherited properties and prototype-sensitive keys.
- Production dependency audit: zero high/critical findings.
- Bundle gate: **fails** at the values above. No blind preview retry.
- All connector modes remain registered. Existing synthetic signer, runtime
  selection/restoration and initial-auth-flow tests pass in the full suite.
  These do not establish live MFA, login, logout or wallet-provider integration.
- No application/Rust/SBF logic changed; no Rust/SBF rerun was needed. No live
  credentials, accounts, orders, funds, deployment configuration or main merge.

## Decision boundary

This bounded pass found and validated actual savings, but did not establish a safe
import-only path under every budget. It is not proof that further optimization is
mathematically impossible. The concrete remaining choices are:

1. **Preserve the current provider and wallet behavior:** pursue a supported v4
   provider entry/upstream change that separates unused UI/API surfaces, then
   measure the complete signing runtime and test configured sessions. No such
   supported entry exists in the installed package exports. This requires
   dependency-owner support or explicitly reviewed upstream implementation work.
2. **Explicitly scope an auth architecture migration:** use the supported headless
   client and implement the full auth/MFA/onboarding/device/session lifecycle,
   including a deliberate legacy Turnkey bridge/migration path. This needs product
   and integration-test decisions; it is not a drop-in bundle change.

Dynamic v5 is not a safe shortcut: its migration guide requires legacy V1/V2
wallet migration for normal operations. Removing legacy support, weakening
security or increasing budgets is outside the approved approach. Retain these
local savings for review while that decision is made; a known-failing preview
publication would not resolve the user's blocker.

Sources: [Next.js bundle analysis](https://nextjs.org/docs/app/guides/package-bundling),
[npm deduplication](https://docs.npmjs.com/cli/v11/commands/npm-dedupe/),
[Webpack resolution](https://webpack.js.org/configuration/resolve/),
[Dynamic v5 migration](https://www.dynamic.xyz/docs/react/reference/upgrade/v5.md).
