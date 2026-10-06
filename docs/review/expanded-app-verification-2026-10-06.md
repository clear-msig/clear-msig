# Expanded app review — 6 October 2026

Local continuation after `36407ee93e0429cdce2e4ce00be9636628bd31ff`. Publication remains held. Original palettes, trading protections, Paystack and Korapay are preserved. No live financial calls, account creation, wallet signing or credential provisioning took place.

## Changes

- Create-wallet route hides the redundant floating create action, leaving the actual form CTA unobstructed on normal and short mobile viewports.
- Owner approval is portaled above the complete app shell; the shell is inert while open. Existing focus trapping, cancellation, scroll lock and focus restoration remain. Provider-owned body overlays are outside the inert shell; only a synthetic overlay boundary was tested, not a real wallet confirmation.
- Recovery detail no longer promises one signature when enrollment explains two wallet confirmations.
- Agent admin loads readiness only when debug view is requested and catches rejected readiness reads.
- Hyperliquid account/connection labels distinguish checking, unavailable and confirmed-empty data. No missing account snapshot is presented as zero open positions. Execution gates are unchanged.
- Member identity and role/action controls reflow into separate mobile rows; names no longer collapse behind the action buttons.

## Coverage and limits

The route table records every one of the 85 app-owned page entries at 390/1440 in the existing dark theme, including aliases rather than counting each alias as a separate layout. Actual application components and builders render against controlled provider/server read boundaries. Three unconfigured setup variants add six desktop/mobile cases. The full route sweep checks page/script errors, overflow and rendered content. SOL send explicitly waits for its review panel; member rows assert readable identity width; venue setup asserts unavailable-data labels.

This is not every possible conditional state, every locale or every real device. Native auth, wallet/provider confirmations, OS/passkeys/hardware and hosted checkout remain external and untested. Descriptors, public profiles, balances, proposals, policies, addresses and notifications in the fixture are synthetic and confer no authority. Unavailable API states are labelled as such, not successful integration tests.

Separate interaction evidence retains 52 combined representative route/state checks, 16 interaction flows, 12 public-ready checks and 12 narrow/dark checks. Owner/onboarding follow-up checks cover both themes, pointer interception, focus containment/restoration and create-CTA clearance at 390×844/500 and desktop. Signing review's final action is hit-testable above navigation at 390×500 in both themes. No actual mobile OS keyboard was tested.

## Evidence corrections

The initial expanded dev run recorded one truncated provider-chunk failure alongside Next's memory-threshold restart. This is distinct from the executor disconnect; shell/files recovered. The earlier mobile-send syntax failure's original cause was not established; its complete 52-case combined rerun passed.

A compiled fixture built without its required backend URL rendered the configuration-error screen. Those captures were excluded, the fixture was rebuilt with a loopback-only backend and the runner now rejects that screen. One setup readiness timeout came from a short valid notice falling below the generic text threshold; all six setup variants were rerun with appropriate readiness. The bare SOL send entry intentionally renders a network chooser. A new assertion initially waited for the form without selecting Solana; the corrected journey selects Solana, then waits for the transaction review region. The chooser-only captures were valid entry states, but did not cover composition. Earlier evidence remains preserved separately, not silently relabelled as passing.

## Remaining release boundaries

- The last inspected published Security run `37495508518` failed the production dependency audit (23 findings: 14 moderate, 9 high; gate identified http-cache-semantics/source-map-js). This UI review does not clear that external release gate or claim fresh remote status.
- Live authentication, wallet confirmation overlays, checkout and settlement are not verified by fixtures. Configured provider/chain integration testing is still required before release.
- Strict venue protection and signed economic authorization requirements remain in force. This follow-up does not implement or authorize concurrent/partial allocations, compensation-based protection or external account provisioning.
- No Rust/SBF source changed in this follow-up, so those checks were not rerun. No push, main change, deployment or additional publication occurred.

## Final validation

- `npm run build`: passed on the final six-source-file change. Includes intent/envelope, metadata and architecture checks, lint, typecheck, 243 passing test files / 1 skipped, 1,916 passing tests / 6 skipped, 27 passing script tests, production compile and bundle gates.
- External-wallet profile 1123.6/1124 kB gzip; legacy Turnkey 979.6/991 kB. Existing limits unchanged.
- Expanded compiled fixture build: passed, with required loopback-only test configuration.
- Supplemental member list at 320 px: passed readable identity-width, script-error and overflow checks.
- Owner/onboarding: 10 passing checks. Signing review clearance: 2 passing checks. Previous combined representative matrix: all 52 passed.

Raw logs/results/captures remain under `/workspace/scratch/app-expanded/`. They include unsuccessful exploratory runs, retained explicitly. The final route evidence is `compiled-pass/route-results.json`; setup variants are `setup-complete/setup-results.json`; the current production log is `final-production-build.log`.

Final compiled combined sweep: **170/170 passed**, 85 entries × 2 widths, 10 aliases/configured redirects (75 distinct resulting paths). Setup variants: **6/6 passed** on the final fixture.

## Screenshot deliverable

Native Library `libfile_47e1522fb3f881919b8d7f83b61f7d53`, version 0; file ID `file_0000000090108210a28ca58ab06a5fb5`. Filename `clearsig-expanded-app-review-2026-10-06.png`, 4,200,141 bytes, 3200×15838, 33 desktop/mobile pairs.
SHA-256: `50c8351bbca48fc716fe67d4f9f1bd84670e86a3ffac5fee21b6c8d57d79de61`.

This is a supplemental expanded board; earlier family boards remain available. It labels synthetic data, top-of-page crops and untested external integrations.

## Redis-enabled verification follow-up

The six skips in the normal build were all in the pre-existing `src/lib/agents/__tests__/serverVenueRedis.integration.test.ts` suite, guarded by `describe.skipIf(!bin || !cli)`. The normal build did not set `CLEARSIG_TEST_REDIS_BIN` and `CLEARSIG_TEST_REDIS_CLI`. No test skip or test-code change was introduced by this UI follow-up; this test file is unchanged from `36407ee9`.

The existing local Redis 7.2.11 binaries under `/workspace/scratch/clearsig-redis/source/src/` were supplied through those two variables and the **entire `npm test` command passed: 244/244 test files, 1,922/1,922 tests, zero skipped; 27/27 script tests, zero skipped**. Log: `/workspace/scratch/app-expanded/final-tests-with-redis.log`. Application source remained at `ea802d7554c66804736abe86a6cd3f21c0b19d07`; no checks were weakened. The suite creates its own temporary append-only Redis instance on an ephemeral loopback port and cleans it up; it never uses the application's database.

The six real-service cases verify:

1. Atomic venue/API-account isolation, including cross-role collisions.
2. One concurrent delivery claim and permanent commitment/account binding.
3. Only pre-handoff reservation release; stale-lease rejection.
4. Database restart without automatic resubmission, followed by idempotent reconciliation.
5. Delivery-record isolation and prevention of cross-deployment account reuse.
6. Atomic single-use native settlement evidence, restart durability and forged-claim rejection.

The executor recovered and commands, compilation and Chromium completed normally. `compiled-complete.log` contains 170 completions and no FAILED lines from one full combined matrix invocation against the compiled fixture on `127.0.0.1:3107` (`next start`, not the restarting development server). `compiled-pass/route-results.json` contains 170 unique route/width pairs with no recorded script/page errors or horizontal overflow; SHA-256 `a09aaffa1ff862601f0247f6180eb8ae0fca4a403764d2a992eb1f970696a5be`. All 170 captures are present. Earlier unsuccessful exploratory runs remain separate. Matrix captures use the existing dark theme at 390/1440; modal/onboarding checks and board additionally include both light and dark. No CSS palette file changed in this follow-up.

Publication remains held for independent visual review. The screenshot Library item and checksum above are unchanged.
