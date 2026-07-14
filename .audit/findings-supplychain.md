# Supply Chain Findings (post-pull)

## Install-time execution posture
- No `.npmrc` anywhere in repo; `.github/workflows/ci.yml:83` runs plain `npm ci`, no `--ignore-scripts`.
- **Confirmed concrete example:** `frontend/node_modules/bigint-buffer/package.json` has an explicit `"install": "npm run rebuild || echo ..."` → `node-gyp rebuild` → compiles `binding.gyp` at install time — a real `install` script, not just implicit gyp auto-build. `bufferutil`, `utf-8-validate`, `sharp` also ship `binding.gyp`.
- **Verdict:** [HIGH] Lifecycle scripts unrestricted in CI and local installs — single highest-leverage supply-chain gap, independent of whether any currently-resolved package is malicious today. Fix: `frontend/.npmrc` with `ignore-scripts=true`, CI `npm ci --ignore-scripts`, explicit allowlisted rebuild step for packages that need native builds.

## Confirmed

### [MEDIUM-HIGH] `bigint-buffer@1.1.5` — GHSA-3gc7-fjrx-p6mg, reachable in production
- Confirmed used by the Solana web3 stack wired into the app (not dev-only). OOB read in `toBigIntLE`. Fix: upgrade if patched release exists, or replace with native `BigInt` APIs.

### [HIGH] `axios` floating across three resolved versions — reachability CONFIRMED via `npm ls axios`
- `axios@1.9.0`, `1.13.2`, `1.15.0` all resolve in `frontend/package-lock.json`, all traced through `@dynamic-labs/sdk-react-core@4.79.0` → `@dynamic-labs-wallet/*` — a runtime wallet-signing SDK shipped to the browser bundle, not a build/dev tool. Real diamond-dependency problem: multiple nested versions of `@dynamic-labs-wallet/core` (0.0.167, 0.0.203, 0.0.259, 0.0.325) each pull their own axios.
- **Impact:** each pre-patch axios version carries known SSRF-via-baseURL-bypass, credential-leakage-on-redirect, and ReDoS issues — now confirmed reachable in the browser bundle used for wallet operations.
- **Fix:** file upstream issue against `@dynamic-labs-wallet` to collapse to one `core` version; in the interim use `npm overrides` in `frontend/package.json` to force a single patched axios resolution, verify wallet SDK still functions.

### [MEDIUM] GitHub Actions pinned to mutable refs
- `superfly/flyctl-actions/setup-flyctl@master` (deploy-fly.yml:34) is the worst case — floats on branch HEAD, runs with `FLY_API_TOKEN` in scope. `dtolnay/rust-toolchain@stable` and all `actions/*@v4`-style tags across workflows are lower-risk but still mutable.
- Fix: SHA-pin `flyctl-actions` at minimum; consider SHA-pinning repo-wide for a wallet product.

### [MEDIUM] `curl | sh` installers without checksum verification
- `deploy-railway.yml:38` (runs with `RAILWAY_TOKEN` in the same job — higher risk) and `ci.yml:133` (Solana/Agave CLI, build-time only, lower blast radius).
- **Good practice found in the same file for contrast:** `ci.yml`'s Quasar CLI install IS pinned to a commit SHA (`cargo install --git ... --rev <sha>`) — use as the template for the other two.
- Fix: replace both with checksum-verified downloads or pinned release archives.

## Needs verification — flagged specifically, high-value item this pass

### `@encrypt.xyz/pre-alpha-solana-client@0.1.1` — single-maintainer, pre-alpha, escrow-adjacent dependency
- **New this update.** `frontend/package.json:28`. Confirmed via live `npm view`: single maintainer (`omersadika@dwalletlabs.com`), 2 published versions (0.1.0 on 2026-04-03, 0.1.1 on 2026-04-30), ~103 downloads/30 days — extremely low install base. **No `preinstall`/`postinstall`/`prepare` lifecycle hooks** (only `generate`/`build`/`clean`) — does not itself trigger install-time execution. No `binding.gyp`. Dependency tree (`@bufbuild/protobuf`, `@grpc/grpc-js`, `@protobuf-ts/*`) is standard gRPC/protobuf tooling.
- **Related finding:** sibling package `@ika.xyz/pre-alpha-solana-client@0.1.1` (same maintainer/cadence) is **vendored (source copied into `frontend/src/lib/ikavery/`) rather than installed as a dependency** — confirmed absent from `package.json`/`package-lock.json`. This sidesteps lockfile integrity checks entirely; the vendored copy has no automated verification against upstream and should be diffed/reviewed for tampering.
- **Judgment:** no confirmed malicious behavior, but "pre-alpha" + single maintainer + ~2-month-old + ~100 monthly downloads + used for confidential-policy/escrow crypto operations in a multisig wallet is a real blast-radius concern — exactly the profile attractive to maintainer-token takeover. Flag as policy/trust decision, not a confirmed compromise.
- **What would confirm/deny:** manual review of the unpacked tarball source for exfiltration code; confirm maintainer 2FA (not externally checkable); diff vendored `@ika.xyz` copy against its upstream publish.

### CVE/CVSS enumeration for Rust dependencies — INCOMPLETE, tooling failure not a clean scan
- syft/grype hung for 15+ min against the full repo (large `frontend/node_modules` walk) and were killed; scoped per-lockfile retries were blocked by intermittent Bash-tool unavailability for the rest of that session. **Do not treat the absence of new Rust CVE findings as "none found" — this is an unresolved tooling gap, not a clean result.**
- Prior (pre-pull, but Rust lockfiles largely unaffected except `rust-settlement`) osv-scanner pass found, worth re-confirming fresh: `openssl 0.10.77`/`0.10.79` (CVSS up to 8.7, GHSA-xp3w-r5p5-63rr / GHSA-hppc-g8h3-xhp3 / GHSA-ghm9-cr32-g9qj), `quinn-proto 0.11.13` (CVSS 8.7, RUSTSEC-2026-0037), `rustls-webpki 0.101.7/0.103.9` (CVSS 7.5, RUSTSEC-2026-0104), `ed25519-dalek 1.0.1` (CVSS 5.9, RUSTSEC-2022-0093 — double-public-key signing oracle, **directly in signature-verification code path for this multisig wallet, escalate regardless of raw CVSS**), `curve25519-dalek 3.2.0` (RUSTSEC-2024-0344), `libsecp256k1 0.6.0` (RUSTSEC-2025-0161), `ws 8.20.0` (CVSS 7.5, GHSA-96hv-2xvq-fx4p), `jsonwebtoken 8.3.0` (CVSS 5.5, GHSA-h395-gr6q-cpjc), `rand` (RUSTSEC-2026-0097, multiple locations).
- `openssl` reachability partially resolved: both root and `rust-settlement` Cargo.lock resolve openssl only via `solana-secp256r1-program` → `solana-precompiles` → `solana-sdk`; since `rust-settlement` handles treasury keys and signs Solana transactions, plausibly reachable, not confirmed which build profile actually links it.
- **Action:** re-run `syft <lockfile-path> -o cyclonedx-json` scoped to individual lockfile artifacts (not directory walks) + `grype sbom:<output>` per lockfile, and `cargo tree --invert` for openssl/rustls-webpki/quinn-proto reachability, in an environment without the tooling issues seen here.

## Dependency inventory
- Rust: 5 committed `Cargo.lock` files (root 821-823, rust-settlement 819-830, programs/clear-wallet 292, client 71, deps/solana-curve25519 28) — `rust-settlement/Cargo.toml` diff for this update is exactly one new dependency: `solana-system-interface = { version = "3", features = ["bincode"] }` — official Solana Labs crate, not a typosquat, no concern.
- npm: `frontend/package-lock.json` ~1005-1011 packages, all from registry.npmjs.org, full integrity-hash coverage, no swapped registry detected. All direct deps use `^` floating ranges including crypto-critical ones and the pre-alpha `@encrypt.xyz` package — recommend exact-pinning the latter given its trust profile.
- No Go anywhere in repo.

## `.github/workflows/security.yml` gating assessment (new workflow, first review)
- Runs CodeQL (JS/TS `security-extended` queries) on push/PR/weekly, and `dependency-review-action@v4` on PRs with `fail-on-severity: high` + AGPL denylist.
- **Dependency-review IS a real blocking control** for the JS/TS side, provided it's set as a required status check on `main` branch protection (not verifiable from the workflow file alone).
- **Gap:** zero Rust-side scanning (no `cargo audit`/`cargo deny`, no osv-scanner/grype/trivy step) despite this being a Rust-heavy repo — all the Cargo.lock findings above are entirely unmonitored by CI. No secret-scanning step in this workflow either (gitleaks ran manually for this audit, not in CI).

## Secrets scan (gitleaks, fresh full-history + working-tree)
- Full history (764 commits): 5 findings, all `generic-api-key` false positives (localStorage key-name string literals, e.g. `"clear.pinned-wallets.v1"`).
- Working tree (`--no-git`): 62 findings, all inside gitignored `frontend/.next/` build cache (auto-generated, not committed).
- **Verdict: clean.** No real committed secrets.

## Coverage
- **Completed:** manual lockfile/manifest/workflow inspection, `npm ls axios` (confirmed reachability), gitleaks full-history + working-tree scan, live `npm view` against `@encrypt.xyz`/`@ika.xyz` registry metadata, `rust-settlement/Cargo.toml` diff review.
- **NOT completed:** syft SBOM generation, grype CVE enumeration (both hung/failed on this environment — see above), fresh osv-scanner run (relying on prior pre-pull pass, needs re-verification), `cargo-audit` (no cargo binary in this environment).
- **Confidence:** High on install-time-execution posture, axios reachability, CI token/pinning hygiene, `@encrypt.xyz` script analysis, secrets. **Low/needs-verification on Rust CVE enumeration — recommend a dedicated follow-up scan** before treating the Rust dependency list above as complete or current.
