# Independent review follow-up — 3 October 2026

Starting commit: `44cdc2bc6b8773c33b956930967f5181a4cf38c4`.
These corrections are local; no publication or live financial interaction.

## Corrected behavior

- Message-signing timeout stops the UI wait, but retains global message-handoff
  exclusion until the underlying provider promise resolves or rejects. A retry
  cannot open a second provider request. Late signatures remain discarded.
  Timeout copy asks the user to finish/cancel the outstanding wallet request;
  it no longer incorrectly asserts that the wallet never opened. A provider
  promise that never settles intentionally keeps the lock: there is no generic
  cancellation acknowledgement from the provider, so releasing it would reopen
  the overlap defect.
- A native prepared-review modal owns Tab events while the underlying owner
  approval dialog is busy. Its keyboard events no longer reach the background
  document focus trap. Cancellation restores the owner heading even if disabling
  the originating button already moved browser focus to the body.
- Closed proposal vote bitmaps are not assigned to current member names. The UI
  explicitly marks historical approver state unavailable and offers the separate
  cryptographically verified history lookup. Active/approved proposals retain
  their current-state display; no Rust authority rules were changed.
- The completion report now explicitly excludes the separate Secure transaction
  signing path from the message-signing claims. Inventory includes
  `NewRecoveryPage` (solo/multimember creation), `ImportKeyPage`,
  `RecoveryThresholdPage` (proposal/execution), and `RecoverySweepPage`
  (proposal/execution), through `DynamicWalletRuntimeProvider.signTransaction`.
  Secure lifecycle validation remains incomplete, not implicitly covered by the
  message-signing review, lock, or browser fixture. Embedded and Ledger Secure
  transaction limitations remain intact.

## Validation

- 30 focused suites / **437 tests pass**, including timeout + retry + late
  provider resolve/reject, closed-proposal current roster/reorder, vote history,
  signing review/contract, error classification and focus-trap regressions.
- Focused ESLint and clean TypeScript check pass.
- Chromium renders the actual `OwnerApprovalDialog` with `busy=true` and actual
  `requestPreparedSigningReview`: Tab/Shift+Tab wrapping, Escape cancellation,
  Continue and return to the owner heading pass. Synthetic permission only;
  no real wallet or submission. Reproducible fixture and runner are in
  `apps/web/scripts/browser-regressions/nestedSigning.fixture.jsx` and
  `nestedSigning.cjs`. Runner needs test-only `esbuild`, `playwright` and Chromium
  (uses `/usr/bin/chromium`); provide these through NODE_PATH without changing the
  application lockfile. It is not an automatically run CI browser test.
- Production compilation exits 0. Applying the existing main push CI metadata
  to the bundle checker selects `main-devnet-2026-10-01-v1` and passes:
  external runtime **1122.6/1124 KiB**, legacy Turnkey **978.6/991 KiB**.
  Without that metadata the stricter default production-ratchet profile fails,
  as before this correction. Neither profile nor its selection rules changed.
  Logs: `/workspace/scratch/review-regressions-build.log`,
  `review-regressions-main-bundles.log`, and `review-regressions-bundles.log`.
  All started build/test processes terminated; none is pending.

## Still separate

Dependency advisory remediation is not included in this correction. No package
versions, audit policy or bundle limits changed. No full-suite or live-provider
pass is inferred from the focused checks. Root Rust/SBF is unchanged.
