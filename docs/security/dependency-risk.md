# Dependency risk register

Status: local remediation on 2026-09-30, based on a fresh npm registry audit,
official advisories, and the September 28 Security workflow for commit
`f74521ec88dca7db697053f42c23313d724ad9d0`. These are local changes, not evidence
that a deployed service has been updated.

## Frontend remediation

The fresh production scan before these changes reported one critical, 17 high,
and 12 moderate package findings. After the changes it reports zero critical,
zero high, and 20 moderate package findings. Package counts include ancestors
of vulnerable transitive dependencies; they are not counts of independent
exploits.

The complete npm graph (including build/test tooling) has zero critical, zero
high, and 35 moderate findings. Targeted updates also replaced vulnerable
brace-expansion, browserslist, js-yaml, and postcss-selector-parser versions.
Security CI now checks the complete graph at the high threshold, as well as
the dedicated production gate. The remaining development advisories affect
`@humanfs/node` and Vitest's browser-mocking path; this project runs `vitest run`
without a browser server. They remain visible for later tooling upgrades.

- Next.js and its ESLint configuration: 15.5.20 to 15.5.27
- Dynamic wallet packages: 4.92.3 to 4.100.3, the upstream v4-LTS line
- Nodemailer: 9.0.3 to 10.0.13; v9 has no fix for the current address-parser high
  advisory
- PostCSS: 8.5.19 to 8.5.28; nanoid resolves to patched 3.3.19
- Axios: override to 1.20.0 because the Dynamic wallet core pins vulnerable
  1.16.0
- sharp: override to 0.35.5 because Dynamic's v4-LTS iconic package still pins
  vulnerable 0.35.0
- `@grpc/grpc-js`: 1.14.4 to 1.14.5 after the final fresh scan surfaced
  advisories published on the review date

The Axios and sharp overrides are compatibility-tested remediation, not advisory
exceptions. Remove them when all upstream consumers select patched versions.
Offline tests exercise Axios JSON handling, Nodemailer's message-generation
API, and sharp's native image-conversion API. Application verification and production builds must also
pass before release.

`npm run audit:prod` rejects every high or critical production finding. It also
rejects incomplete, inconsistent, or error-bearing npm reports. There are no
accepted high/critical npm exceptions. The earlier `bigint-buffer` exception is
obsolete: the repository already uses `vendor/bigint-buffer-safe`, the local
pure-JavaScript compatibility implementation, through an npm override.

### Exposure is conditional on use

- [Next.js AVIF image optimization RCE](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)
  affects the old version through sharp/libheif; the patched Next line initially
  disabled AVIF optimization. The image optimizer is configured with two
  CoinGecko remote hosts. This audit does not demonstrate attacker-controlled
  image delivery or a successful exploit.
- [Next.js Windows-hosted RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36)
  requires a Windows filesystem. The repository's Linux containers do not
  demonstrate that precondition, but the dependency still needed updating.
- [Nodemailer address-parser DoS](https://github.com/advisories/GHSA-v53p-9fqp-m79j)
  depends on sufficiently large hostile address text. Existing invitation
  routes bound recipient strings, which reduces that specific exposure; it is
  not a reason to retain the vulnerable package.
- Several Axios advisories require the Node HTTP/HTTP2 adapter or an existing
  prototype-pollution primitive. Wallet browser use alone does not establish
  those preconditions. The lockfile version was patched regardless.

- [gRPC-JS certificate authorization](https://github.com/advisories/GHSA-m9gg-hp2v-232j)
  requires a TLS server configured with `requireClientCertificate=false` and
  reliance on `getAuthContext()` for authorization. The inspected dependency
  enters through the Ika client; this review does not demonstrate that server
  configuration. Version 1.14.5 also addresses the associated
  [certificate-info validity issue](https://github.com/advisories/GHSA-f596-whhp-79r4).

### Remaining moderate findings

Two underlying advisories account for the 20 remaining production package
findings. The final scan expanded ancestor attribution compared with the earlier
9-production/12-full-graph result; these are the same underlying moderate
advisories, not 20 independent production vulnerabilities:

1. [decode-uri-component denial of service](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr),
   through WalletConnect's `query-string` dependency. Patched upstream version:
   0.5.0. Crafted percent-encoded input can consume excessive CPU. This requires
   a WalletConnect/query-string dependency update or a separately validated
   cross-minor override; limiting untrusted URI length is a mitigation, not a
   dependency fix. End-to-end exploitability has not been demonstrated here.
2. [stream-json path-filter denial of service](https://github.com/advisories/GHSA-528h-pc64-c93x),
   through `jayson@4.3.0`. The vulnerable functions are its path filters. The
   installed Jayson code uses `StreamValues` and `Verifier`, and its browser
   client uses `JSON.parse`; the inspected path does not call those vulnerable
   filters. Do not force stream-json 3.x into the 1.x consumer without migration
   testing. The available Jayson 5 release removes that dependency but is a
   major-version migration.

## Rust remediation and policy

The [September 28 Security run](https://github.com/clear-msig/clear-msig/actions/runs/36412152657)
failed the root lockfile audit with two vulnerabilities. Cargo, using the
official registry, generated these updates:

- Root `h2`: 0.4.14 to 0.4.16, addressing
  [unbounded empty HTTP/2 DATA frames](https://rustsec.org/advisories/RUSTSEC-2026-0258.html)
- Root `rustls`: 0.23.40 to 0.23.45, and standalone settlement `rustls`: 0.23.42
  to 0.23.45, addressing
  [TLS handshake encryption-level validation](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)
- Required TLS dependencies were resolved by Cargo, including rustls-webpki
  0.103.15 and the settlement AWS-LC provider update
- Settlement `ruint`: 1.19.0 to 1.20.0, addressing
  [incorrect shift overflow flags and truncated amounts](https://rustsec.org/advisories/RUSTSEC-2026-0220.html)
- Settlement `event-listener`: 5.4.1 to 5.4.2, addressing
  [thread-safety unsoundness for non-Send tags](https://rustsec.org/advisories/RUSTSEC-2026-0221.html)

The h2 advisory is a resource-exhaustion issue. The rustls advisory does not
allow a network-position attacker to alter or complete an authenticated
handshake; it concerns accepting messages at an incorrect encryption level.
Neither advisory alone establishes transaction-signature compromise.

`cargo-audit` scans lockfile entries, including optional entries. `cargo-deny`
checks the resolved graph and enforces license/source policy. The reviewed
unmaintained wire/test exceptions in `deny.toml` remain: bincode, derivative,
libsecp256k1, and paste. No new exception was added for h2 or rustls.

The standalone settlement service is outside the root workspace. Its explicit
lockfile scan retains only the existing `RUSTSEC-2023-0071` RSA exception, for
the optional SQLx MySQL dependency while settlement uses PostgreSQL. A root
workspace cargo-deny run does not validate that standalone graph; it must be
checked with the settlement manifest explicitly.

Fresh verification with cargo-audit 0.22.2 and cargo-deny 0.20.2:

- Root lock audit: zero vulnerabilities, with the existing unmaintained warnings
- Root graph: advisories, bans, licenses, and sources pass
- Settlement lock audit with only the existing RSA exception: zero vulnerability
  findings; unmaintained warnings and the lru unsoundness warning below remain
- Explicit settlement graph advisory check: passes the current policy

The passing graph check is not a claim that every informational advisory is
gated. cargo-deny 0.20.2 defaults `unsound` to workspace crates. Settlement's
reachable `lru@0.16.4`, through Alloy provider 2.1.1, remains covered by
[RUSTSEC-2026-0253](https://rustsec.org/advisories/RUSTSEC-2026-0253.html).
That issue requires a cache key whose `Drop` panics, unwinding/catching that
panic, and subsequent cache use. The inspected Alloy caches use `u64` and
`B256` keys, which do not provide that precondition; no exploit was demonstrated.
This is still version debt. Alloy provider 2.4 selects patched lru >=0.18.2 but
raises its minimum Rust version from 1.91 to 1.94.1, so it needs an explicit
toolchain/Alloy compatibility migration. Do not add an advisory ignore or claim
the dependency is patched. Consider gating transitive unsoundness after that
migration.

## CI findings addressed

- Independent Rust policy steps continue after an earlier audit failure, so a
  root finding no longer hides settlement or graph-policy results
- Security-events write permission is limited to CodeQL; ordinary CI has
  read-only repository permissions
- Manual Railway service and smoke-test address inputs enter shell scripts
  through quoted environment variables, avoiding expression interpolation into
  shell source
- Release runners use macOS 15 Intel/ARM instead of the retired macOS 13 and
  retiring macOS 14 images; release builds use the checked lockfile. See the
  [official runner retirement notice](https://github.com/actions/runner-images/issues/13046)

Manual deployment and tag-release workflows still do not independently require
the complete test/security suite to pass for the selected commit. Repository
branch/environment protection settings were not changed or verified by this
local remediation. Keep the documented release-validation requirement, and do
not treat successful compilation alone as approval to deploy.

## Bundle policy

Do not increase bundle limits merely to make a dependency upgrade pass. The
existing regression limits remain 971 kB for the authenticated runtime, 954 kB
for legacy Turnkey, 1,100 kB for the external-wallet runtime, and 506 kB for an
individual chunk (gzip). The product targets remain 250 kB per route and 150 kB
per chunk. Rebuild and measure the updated graph; the July measurements are
historical and are not evidence for the September dependency set.

The final production build completed compilation and all 50 static pages, but
its unchanged bundle gate fails: authenticated runtime 1,016.2 kB (limit 971),
external 1,145.6 kB (1,100), legacy Turnkey 1,005.2 kB (954), largest chunk
541.0 kB (506). The supported Webpack build-worker setting resolved the earlier
memory failure without suppressing checks. Bundle optimization remains a release
gate; no budget was increased.

A passing dependency gate is not a production security approval. The pre-alpha
Ika signer and unaudited program remain independent release risks.
