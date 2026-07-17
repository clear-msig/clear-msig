# Dependency risk register

Status: local audit on 2026-07-17 after direct dependency remediation.

## Remediation completed

- Dynamic wallet packages moved from 4.79.0 to 4.92.3.
- Next.js moved from 15.5.15 to 15.5.20.
- Nodemailer moved from 8.0.7 to 9.0.3.
- PostCSS moved to 8.5.19.
- Vitest moved from vulnerable 2.1.9 to 4.1.10.
- All compatible `ws` 8.x consumers are locked to patched 8.21.1.

The production audit moved from 28 high findings to four high package nodes and
zero critical findings. The complete dependency audit has zero critical
findings.

## Accepted pre-alpha debt

The remaining production high findings are one dependency chain:

`@dynamic-labs/solana-core -> @solana/spl-token ->
@solana/buffer-layout-utils -> bigint-buffer@1.1.5`

The npm registry currently reports 1.1.5 as the latest `bigint-buffer` release,
and that release is still covered by the advisory. There is no patched package
version to select. Removing the chain would remove the Dynamic Solana wallet
runtime used for embedded and external wallet signing.

This is not considered resolved. `npm run audit:prod` fails on any critical or
any high package outside the four named nodes in the chain. Security CI runs
that ratchet on pushes, pull requests, and the weekly schedule. The exception
must be removed as soon as Dynamic/Solana publish a compatible patched graph.

No production release for real funds should proceed while this high dependency
risk, pre-alpha Ika signer, and unaudited v4 program remain open.

## Rust dependency policy

`cargo-audit 0.22.2` and `cargo-deny 0.20.2` were installed and exercised on
2026-07-16. Security CI now runs both tools. `cargo-deny` is the authoritative
reachable-graph check; `cargo-audit` also scans optional lockfile entries and
therefore carries explicit lock-only exceptions where the graph-aware check
would still fail if they became reachable.

The execution/backend graph no longer depends on the broad `solana-client`
crate. It uses `solana-rpc-client` and `solana-rpc-client-api` directly, which
removed the unused TPU, QUIC, PubSub, and legacy WebPKI runtime paths. All Git
dependencies are pinned to immutable revisions, including the deleted Quasar
branch previously referenced by name. First-party Rust crates now declare the
`BSD-3-Clause-Clear` license, and cargo-deny rejects unknown registries, unknown
Git organizations, unapproved licenses, and new advisories.

The first-party off-chain clients and standalone settlement service now use the
Solana 3 split crates. The root audit reports no known vulnerability; it still
warns about unmaintained wire/test dependencies (`bincode`, `derivative`,
`libsecp256k1`, and `paste`) and the Agave SVM test graph's `rand 0.7` warning.
Those packages remain coupled to Quasar/Agave compatibility and are explicit in
`deny.toml`; unrelated or newly introduced advisories still fail CI.

The standalone settlement service also moved its EVM signer from Ethers 2 to
Alloy 2. That removed the vulnerable Ring 0.16 and legacy WebPKI provider graph.
Its only cargo-audit vulnerability is `rsa 0.9.10`, an unreachable optional
`sqlx-mysql` lockfile entry while the service builds PostgreSQL only. The
workflow carries that one lock-only exception; the reachable graph remains
checked by Cargo feature resolution, compilation, and cargo-deny in the root
workspace. The exception must be removed when SQLx publishes a lock graph that
does not include it or when RustSec publishes a fixed RSA release.

## Bundle impact

The patched Next and Dynamic graph increased the measured maximum authenticated
route from 939.8 kB to 967.6 kB gzip and the legacy Turnkey profile from 912.0
kB to 951.0 kB. Dynamic's shared core is 504.2 kB gzip. Attempts to force that
core into smaller Webpack chunks increased total route transfer by about 80 kB
because cross-module compression was lost, so that change was rejected.

The route-aware regression ratchets are therefore 971 kB for the current
authenticated runtime, 954 kB for legacy Turnkey, and 506 kB for an individual
chunk. These include a narrow allowance for platform-dependent gzip output and
are measured security-upgrade baselines, not performance targets.
The existing 250 kB route and 150 kB chunk product targets remain unchanged,
and the budget still counts each route's shared and owned chunks exactly once.
