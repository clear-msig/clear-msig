# Main devnet CI repair — 2026-10-01

The main push at `37d01706980e133b433069ce15f9a879a8b85a93` triggered [CI run 36906952929](https://github.com/clear-msig/clear-msig/actions/runs/36906952929). Its three failing jobs were independently diagnosed from their logs:

- Signing architecture: proposal review and finalized agent readers repeated the v4 envelope domain and encoder.
- SBF: compilation succeeded, but the checked generated Rust client lacked asset-policy and recurring-asset instruction exports and decoders (discriminators 36–38).
- Frontend: compilation and 1,721 tests passed; six Redis integration cases were skipped because the runner had no configured Redis executables. The final production size gate rejected the secured dependency graph.

## Repairs

The browser review and both finalized RPC readers now consume one envelope verifier generated from the canonical Rust field declarations, constants and hashing operations. The generator rejects unknown operations, integer widths and validation changes. The architecture check verifies the generated file exactly before permitting its domain; handwritten domains elsewhere remain rejected. Protocol bytes, hashes, signatures and account identities are unchanged. Existing cross-language golden-vector and adversarial account tests remain, with new range and generator-drift tests. This verifier checks existing authority; it does not introduce a client-side signing-authority preparation path.

The Rust client was regenerated with the exact CI-pinned Quasar revision `2d5f2d84ff3c13794958f64c22721388280f4ae3`. No on-chain program logic changed. The original generated-client comparison remains mandatory.

Frontend CI installs Redis and passes executable paths to tests. The tests start an isolated process on a random localhost port with temporary AOF storage, including restart persistence; no shared service, credentials or financial accounts are used.

## Approved main devnet size baseline

The user explicitly extended the reviewed preview baseline to the current main **devnet** build on 2026-10-01. `main-devnet-2026-10-01-v1` uses precisely the same ceilings: standard app 999 KiB, external-wallet runtime 1124 KiB, legacy Turnkey 991 KiB, largest chunk 518 KiB. Original measurement provenance remains in `apps/web/scripts/bundle-baselines/review-preview-2026-10-01-v1.json`.

Selection requires either:

- Vercel production target (target metadata absent or explicitly production), exact repository owner/slug `clear-msig/clear-msig`, branch `main`, and `VERCEL=1`; or
- GitHub Actions push event, exact repository `clear-msig/clear-msig`, ref `refs/heads/main`, and no Vercel context.

The original review-preview branch scope remains. Missing, malformed, unrelated, custom-target and PR contexts retain the original baseline. There is no arbitrary numerical environment override. Metadata selection identifies an approved build channel, not cryptographic proof of an RPC network: this approval does not authorize mainnet rollout, and any future deployment-channel change requires explicit scope review. No provider was removed or weakened.

The Vercel repository/branch fields are documented [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables). No hosted settings were changed. Public-page, connect-page and route-owned limits are unchanged; final 250/150 KiB targets remain. Tests verify exact scope and reject one byte over each measured ceiling.

The repaired build measures approximately 998.8 KiB standard, 1123.7 KiB external and 990.7 KiB Turnkey; its largest chunk remains within 518 KiB. These are still large payloads, not a claim that the long-term performance target is met.

## Local validation before publication

- Frontend: 223 suites / 1,736 tests, including all six real isolated Redis cases.
- Script tests include generated-verifier parity, unsupported-schema rejection and build-scope/size boundary regression checks.
- Exact CI host Rust command: 229 passing tests, one existing ignored doctest.
- Strict selected-crate CI Clippy, workspace formatting and generated-client equality pass on Rust 1.99.0.
- Production compilation and approved main-devnet size check pass.
- Current on-chain source is unchanged; the prior main hosted SBF compile passed. The next hosted run must validate repaired client equality and the previously skipped dependent SVM tests.

Hosted CI/deployment outcomes must be read on the newly pushed SHA; the successful previous preview is not evidence of main deployment success. No live authentication, wallet, payment or venue transactions were exercised by these checks.
