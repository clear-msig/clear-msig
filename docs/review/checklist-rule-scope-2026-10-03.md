# Rule-specific setup and imported teammates

This correction preserves the external main changes through `f59552cd`.

- Setup displays each active spending rule's own roster, threshold and delay.
  Governance rosters and thresholds are shown separately and remain visible
  when setup guidance is dismissed. An optional zero delay does not imply
  single-person payment approval.
- Imported addresses are displayed in full and offered for explicit review
  against each rule where they are absent. Links carry that rule, exact address
  and approver-only role; they do not grant authority. Invalid explicit rule
  selection never falls back to a different rule.
- Add-member and threshold flows retain selected-rule scope. New-wallet copy
  explains that UpdateIntent initially belongs to the creator alone.
- All shared typed authority edits now compare the complete executable rule
  definition, including ciphertexts, against the existing account before any
  signature. Registered templates with identical text are distinguished by
  their compiled bytes. Unknown or incompatible custom definitions are refused;
  they are never replaced with a default transfer rule. Extending edits to
  unregistered custom definitions remains unsupported rather than destructive.

## Verification

- Frontend verify: 241 suites, 1,903 tests, plus 27 script tests passed, with
  local Redis integration enabled. After incorporating the external bundle
  commit, all 27 script tests were rerun successfully.
- Chromium at 320 and 390 CSS pixels: actual checklist and add-member components
  with synthetic query/provider data. Checked distinct rule rosters, optional
  delay, exact draft address carried into the form and full review receipt,
  creator-only governance disclosure, unavailable-rule gate and no horizontal
  overflow. Captures were inspected. No palette changes.
- Final production compilation and default devnet bundle ratchet passed:
  external-wallet 1,123.6 / 1,124 kB, Turnkey 979.6 / 991 kB.
- Browser runner: `apps/web/scripts/browser-regressions/setupChecklist.cjs`.
  Requires Playwright, esbuild and Chromium; uses project Tailwind. Optional
  `CLEARSIG_REVIEW_OUTPUT` selects the screenshot directory (default is a
  temporary-directory `clearsig-checklist-review` folder).
- This is not live authentication, device signing, chain submission, invitation
  email or payment testing. Root Rust/SBF code was not changed or rerun locally.
- No dependency or bundle-budget edits in this correction. The pre-existing
  dependency security gate is tracked separately and is not waived here.
