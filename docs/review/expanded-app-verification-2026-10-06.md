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
