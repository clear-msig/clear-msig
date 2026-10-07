# Budget and Bitcoin follow-up — 7 October 2026

Continuation of local commit `8f773db8840d6026b8a9bb202a94bb6e0c7bf5cc`. Publication remains held. Executor commands, builds, Chromium and Library upload are working after the reboot; no current quota blocker was observed.

## Corrections

- Wallet-wide and all five per-chain weekly budget inputs can shrink inside their own cards. The `/ week` suffix stays unwrapped and visible. The regression checks each input/suffix against its card bounds at 320, 390 and 1440 px, not merely document overflow.
- Bitcoin composition now orders amount/recipient/note, the complete review, then the send action. The existing “above” instruction now points to fields above it. Exact review data, validation, fee/UTXO selection and signing handoff are unchanged.
- The new typing regression exposed a shared signing-hook bug: a native capture-phase input listener forced a React refresh before `onChange`, restoring the old controlled value before the edit reached its handler. `subscribeSigningReviewInvalidation` still increments the signing revision synchronously, immediately invalidating stale reviews. Only its display refresh is scheduled for the next task. Repeated invalidations are preserved; refreshes are coalesced; cleanup removes listeners and cancels pending refreshes. No authority check or signing guard is deferred.

## Verification

- Six focused compiled-browser cases passed: Budget and Bitcoin at 320/390/1440, with actual components and synthetic provider reads. Checks cover all six weekly-limit rows, readable suffixes, DOM/visual ordering, repeated Bitcoin edits, retained destination/note, updated review amount and disabled submission for an empty-UTXO fixture. Inputs are cleared after the interaction check for the screenshot.
- Four new event-ordering regressions pass: immediate invalidation before the input handler; deferred/coalesced refresh; unmount cleanup; policy storage filtering. Real browser typing failed with the old capture-refresh implementation and passed after the fix.
- Full Redis-enabled `npm run build` passed with 245 test files / 1,926 tests and 27 script tests; zero skipped. The final per-chain CSS extension was then rechecked through lint, TypeScript, production compile and bundle gates, all passing. External-wallet bundle 1123.7/1124 kB; legacy Turnkey 979.6/991 kB. Limits unchanged.
- A fresh complete compiled-fixture route sweep is recorded separately in `/workspace/scratch/app-expanded/last-complete-matrix/`; its terminal result is appended below. The earlier 170-case evidence remains preserved, not overwritten.

Focused evidence: `/workspace/scratch/app-expanded/card-complete/focused-results.json`. Full test/build log: `/workspace/scratch/app-expanded/residual-final-build.log`. New guard tests: `/workspace/scratch/app-expanded/review-events-test.log`. No Rust/SBF code changed or rerun.

## Fresh screenshot board

Library `libfile_1b93a828e3f48191a234c0d3bf2a178f`, version 0; file ID `file_00000000609482109e8d8c8e4d455a0b`.
Filename `clearsig-budget-bitcoin-review-2026-10-07.png`, 800,075 bytes, 1920×4109.
SHA-256: `6f8243f0eced4331345ee0d36c72a6846892d220d3d95aef045b4464dd3e0cd7`.

This supplemental board supersedes the Budget/Bitcoin images on the earlier expanded board; other earlier screenshots remain applicable. It shows actual local renders, with synthetic data explicitly disclosed. The original palettes are unchanged. No live signing, provider account, checkout, settlement or venue execution was tested or performed. No push or deployment occurred; independent visual review and publication approval remain outstanding.

Final complete compiled-fixture run: **170/170 passed**, all 85 entries at 390/1440, no recorded page/script errors or horizontal overflow. One successful combined invocation; no stitched retries. Matrix SHA-256: `fd5092c35be9daeb9077f7a0740cf8d4882c0c627a9a51a75687ba28146e38a4`. Focused 320/390/1440 card and Bitcoin checks additionally passed 6/6. The review server was stopped after completion.
