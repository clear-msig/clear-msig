# ikavery (vendored)

Source: <https://github.com/Iamknownasfesal/ikavery>
Upstream package: `@fesal-packages/ikavery-solana-sdk@0.1.0`
License: BSD-3-Clause (see `LICENSE`)
Author: fesal (<https://github.com/iamknownasfesal>)

## Why vendored

The published `ikavery-solana-sdk@0.1.0` declares its `ikavery-core`
dependency as `workspace:*`, which `npm` cannot resolve from the registry.
Rather than fight upstream packaging, we vendor the Solana SDK source
directly.

## What's vendored

- All of `solana/packages/sdk/src/` - the Solana SDK proper.
- One helper from `packages/core/src/passkey/spki.ts`
  (`derSigToCompactRaw64`) - the only symbol the Solana SDK consumes from
  ikavery-core. Lives at `_core_helpers.ts` in this directory.

## What's NOT vendored

- The Sui SDK (`sui/packages/sdk/`) - clear-msig is Solana-only.
- The rest of `ikavery-core` - only one helper is used.
- The Quasar program source - we read state via the deployed program ID.

## Modifications

- `passkey/assertion.ts:19` - import path rewritten from
  `"@fesal-packages/ikavery-core"` → `"../_core_helpers"`.

If the upstream republishes with resolved dep specs, swap our `_core_helpers.ts`
back to the package import and delete this directory in favor of an
`npm install @fesal-packages/ikavery-solana-sdk`.
