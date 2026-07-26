# Source attribution audit

Status: ClearSig ownership and third-party provenance separated. Legal review
is still required before changing any retained third-party notice.

| Path | Notice/origin | License evidence | Action |
| --- | --- | --- | --- |
| `apps/e2e/src/main.rs` | Copyright dWallet Labs, Ltd. | `BSD-3-Clause-Clear` header | Retain; third-party provenance |
| `apps/e2e/src/ika_evm_demo.rs` | Copyright dWallet Labs, Ltd. | `BSD-3-Clause-Clear` header | Retain; third-party provenance |
| `apps/web/src/lib/ikavery/bcs-types.ts` | Copyright dWallet Labs, Ltd. | `BSD-3-Clause-Clear` header | Retain |
| `apps/web/src/lib/ikavery/LICENSE` | Copyright 2026, fesal | BSD-style text | Retain; do not replace without provenance review |
| `apps/web/src/lib/ikavery/NOTICE.md` | Local provenance notice | Local license files | Retain and verify upstream revision |
| `deps/solana-curve25519/` | Vendored Anza/Agave package metadata | Upstream package metadata, no root notice found | Retain metadata; add source/revision record before modification |
| ClearSig-owned source | ClearSig contributors | Root `LICENSE`, matching Cargo package declarations | `BSD-3-Clause-Clear`; file headers are optional |

## Legacy product search

No legacy product copyright or branding notice remains in active ClearSig
source. The repository boundary gate rejects reintroduction of that standalone
product attribution while ignoring ordinary engineering words such as
"adapter".

## Licensing boundary

The root `LICENSE` now supplies the `BSD-3-Clause-Clear` text already declared
by ClearSig Rust packages. It does not replace or relicense files that carry a
third-party notice. dWallet Labs headers, the Ikavery license, and vendored
dependency metadata remain intact.
