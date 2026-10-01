# Approved review-preview bundle baseline

The user explicitly approved a measured preview performance rebaseline on
2026-10-01 after reviewing the remaining secured-SDK overhead. This is not a
production performance waiver or authorization to release the application.

`review-preview-2026-10-01-v1` applies only when all required build metadata
matches: `VERCEL=1`, `VERCEL_ENV=preview`, and
`VERCEL_GIT_COMMIT_REF=review/security-ux-audit-2026-09-30`.
If `VERCEL_TARGET_ENV` is present it must also be `preview`. Missing required
metadata, other branches, development/custom environments, and production use
original limits. These values select a build policy; they are not an authentication
or deployment-authorization mechanism. No Vercel project setting was changed.

| Profile | Measured gzip bytes | Preview limit (KiB) | Original limit (KiB) |
| --- | ---: | ---: | ---: |
| Standard authenticated | 1,022,438 | 999 | 971 |
| External wallet | 1,150,377 | 1124 | 1100 |
| Legacy Turnkey | 1,014,102 | 991 | 954 |
| Largest chunk | 530,226 | 518 | 506 |

Each preview limit is the exact measured maximum rounded up to the next whole
KiB, with less than 1 KiB extra space. Every checked route/runtime/chunk must
stay below its applicable limit; exceeding it by one byte fails. Limits do not
recalculate or grow automatically. The public-page 260 KiB total / 180 KiB owned,
connect 1100 KiB total / 230 KiB owned, and authenticated route-owned 230 KiB
limits remain unchanged. Long-term targets remain 250 KiB route / 150 KiB chunk.

The source baseline is commit `161a2b84925301db46ddb529a8cd8a321673a41e`, tree
`bb4eaa09633bbdefac0d6c16b84a332501267164`. The machine-readable record at
`apps/web/scripts/bundle-baselines/review-preview-2026-10-01-v1.json` preserves
exact measurements, tool versions, package/configuration checksums and both
Next build-manifest checksums. It documents provenance; it does not exempt a
future source change from size checks. The dependency improvements and remaining
integration gates are described in `bundle-remediation-2026-10-01.md`.

Reproduce the preview build from `apps/web` with:

```sh
VERCEL=1 VERCEL_ENV=preview \
VERCEL_GIT_COMMIT_REF=review/security-ux-audit-2026-09-30 npm run build
```

Then validate the original gate against the same compiled output:

```sh
env -u VERCEL -u VERCEL_ENV -u VERCEL_TARGET_ENV -u VERCEL_GIT_COMMIT_REF \
  npm run check:bundles
```

The latter is expected to fail while the original budgets remain unmet. A preview
pass must not be reported as a production-budget pass. Promoting an existing
preview artifact is a separate operator action, not something this build script
can authorize or prevent; no promotion or production deployment is authorized.
No security checks, runtime accounting, supported connectors or live integration
requirements were removed.

## Local verification

The complete `npm run build` passed under the exact approved preview metadata:
222 Vitest suites / 1,727 tests, 20 script tests, all metadata/architecture/lint/type
checks, production compilation and 50 generated pages, followed by the selected
preview bundle gate. The same compiled output checked without preview metadata
exited 1 under `production-ratchet-2026-07-16`, retaining the original failures.
Synthetic provider tests are not live wallet/authentication validation.
