# ClearSig bigint-buffer compatibility package

This private package replaces `bigint-buffer@1.1.5`, which has no patched
upstream release for `GHSA-3gc7-fjrx-p6mg`. The vulnerable package attempts to
load a native binding; this implementation is pure JavaScript and contains no
native allocation path.

The package implements only the four functions consumed by
`@solana/buffer-layout-utils`: `toBigIntLE`, `toBigIntBE`, `toBufferLE`, and
`toBufferBE`. It rejects negative values, invalid widths, and values that do
not fit instead of truncating them.

Remove this override when the Solana dependency graph no longer installs
`bigint-buffer`, or when an independently reviewed upstream release fixes the
advisory. Any change must continue to pass the direct fixed-width tests and the
installed Solana `u64` layout integration test.
