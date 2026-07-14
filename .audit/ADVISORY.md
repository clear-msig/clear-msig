# Security Advisory — clear-msig
*Read-only audit. Nothing in this codebase was modified.*
**Date:** 2026-07-14  |  **Scope:** Full repository at HEAD `c171aa3` — on-chain program (Rust, `quasar_lang`), `backend-api` (Axum), `rust-settlement` (Axum + Postgres + Paystack/Kora fiat rails + custodial treasury hot-wallet), Next.js frontend (Dynamic Labs WaaS + Ledger). Restarted from scratch after an 871-file upstream pull — this is the only pass that matters.

## Coverage & confidence

| Domain | Method | Confidence |
|---|---|---|
| AppSec | semgrep (owasp/security-audit/rust/ts/nodejs/secrets) + manual hotspot review (full read of `policy.rs`, `advanced_policy.rs`, `clearsign.rs`, all `rust-settlement` workers/handlers) | High |
| Supply chain | manual lockfile/manifest/workflow review, `npm ls`, gitleaks (full history + working tree), live `npm view` on new deps. **Rust CVE enumeration incomplete — syft/grype hung, no fresh osv-scanner, no cargo-audit (no cargo binary available)** | **Reduced for Rust deps — see gaps** |
| Identity | manual review of auth surface, treasury key loading, both webhook HMAC verifiers, agent-vault on-chain enforcement | High (Solana signer only — EVM/BTC/Zcash signers, frontend token storage not reviewed) |
| Infra | trivy config (HIGH/CRITICAL), checkov (Dockerfile + workflows), manual review of all 6 GH Actions workflows, Dockerfile, entrypoint, render/fly/railway configs | High (branch-protection required-checks config not verifiable — no `gh` auth) |
| Agentic/MCP | Correctly skipped — no MCP surface. "Agent" = trading-vault delegation feature, reviewed by appsec/identity instead | N/A |

**Gaps you should know about:**
1. Rust dependency CVE list is **not current** — tooling failed this pass (syft/grype hung 15+ min, killed; no fresh osv-scanner run). The CVE list below is carried over from a prior scan and must be treated as needs-verification, not confirmed.
2. No CI-enforced Rust SAST/dependency scanning exists at all (`security.yml` is JS/TS-only) — so even a future clean local scan wouldn't be continuously monitored without adding one.
3. Branch-protection required-status-check configuration could not be inspected from this environment.
4. `AgentTradeSettlement` oracle-price replay/staleness was not fully traced by either appsec or identity — flagged, not resolved.

## Executive summary

The single most important finding in this audit is a **complete, unauthenticated, self-serve theft path against the fiat treasury**: an unauthenticated `/v1/internal/chain/confirm` endpoint lets anyone fabricate a "finalized" on-chain deposit and trigger a real NGN bank payout without ever sending crypto, and it compounds with a self-asserted `x-user-id` header that provides zero real authentication anywhere in `rust-settlement` — together these let an attacker impersonate any user and drain the settlement float with no prior access, no leaked secret, and no crypto ever moving. This must be fixed before anything else. The genuinely good news: the on-chain program core — the new typed policy engine (`policy.rs`, `advanced_policy.rs`) and the ClearSign v2 hash-binding scheme (`clearsign.rs`, `message.rs`) — was reviewed in full this pass and found sound: bounds-checked, fails closed on malformed input, and free of WYSIWYS divergence between what a user signs and what executes on-chain. The remaining open risk is coverage, not just findings: Rust dependency CVE enumeration is incomplete due to tooling failures this pass (the CVE list carried over from a prior scan is unverified), and CI has no Rust-side scanning at all, so that gap will persist until someone runs a scoped scan and adds a CI step. A root-running container with a direct decode path to the treasury keypair, and a novel pre-alpha single-maintainer dependency used for confidential escrow operations, round out the items worth real attention.

| Severity | Count |
|---|---|
| Critical | 1 (two-root-cause cluster) |
| High | 4 |
| Medium | 5 |
| Low | 1 |
| Informational | 4 |

## Attack chains

### Chain 1 — Unauthenticated treasury drain via forged deposit confirmation · **CRITICAL**
`x-user-id` header trusted with zero verification (impersonate any user, or just use your own identity) → create a self-serve offramp intent with your own bank account → `POST` a forged `finalized:true` `ChainTransferConfirmationRequest` to unauthenticated `/v1/internal/chain/confirm` with your `intent_id` → raw upsert into `ramp_chain_transfers`, no on-chain verification → `chain_confirmation` worker flips intent to `settlement_completed` on `is_finalized=TRUE` alone → `payout_dispatch` fires a real Paystack/Kora bank payout → **compounded further** because the payout amount is taken from client-supplied `usd_amount_cents` at quote time and never reconciled against a trusted independently-observed transfer amount, so the attacker can also inflate the payout beyond what a real deposit would justify.
**Cheapest break:** add auth (shared-secret/HMAC/mTLS, constant-time compare) to `/v1/internal/chain/confirm` — this alone kills the theft path even before the `x-user-id` and reconciliation issues are fixed, because the fabricated confirmation can no longer be submitted at all.

## Findings — prioritized

### 1. [CRITICAL] Unauthenticated `/v1/internal/chain/confirm` + self-asserted `x-user-id` — complete unauthenticated treasury theft
- **Domain:** appsec, identity (both independently traced the full exploit chain end-to-end — high confidence)
- **Location:** `rust-settlement/src/http/handlers.rs:65,500-556` (`chain_confirm`, no auth in `build_router:50-69` or `main.rs:103-105`); `handlers.rs:37-44` (`user_id_from_headers`), used in `create_intent:87-99`, `get_intent:170`, `prepare_signature:217`, `initialize_payment:270`
- **Confidence:** Confirmed — reachability traced from an unauthenticated HTTP request all the way to a real Paystack/Kora bank transfer, by two independent auditors
- **Attack:** Create an offramp intent with own bank details and a self-chosen `x-user-id` → POST a fabricated finalized deposit confirmation with your own `intent_id` → intent flips to `settlement_completed` → real NGN payout dispatched. No crypto ever sent.
- **Impact:** Direct theft of the settlement provider's fiat float, unauthenticated, repeatable, self-serve.
- **Fix:** Gate `/v1/internal/chain/confirm` with strong service-to-service auth (shared-secret/HMAC/mTLS, constant-time compare) or switch to a pull model where the service independently verifies deposits via RPC/indexer before trusting `finalized=true`. Separately, replace `x-user-id` with a verified session/JWT bound to a proven wallet pubkey (e.g. Dynamic Labs WaaS session claims) and derive user identity server-side, never from a client header.
- **Effort:** S (auth gate) + M (proper identity binding)

### 2. [MEDIUM, part of Chain 1] Offramp payout amount never reconciled against actual confirmed transfer
- **Domain:** appsec
- **Location:** `rust-settlement/src/contracts/api.rs:22-35`, `services/intents.rs:88-236`, `workers/webhook_processing.rs:172-200`, `payout_dispatch.rs`
- **Confidence:** Confirmed
- **Impact:** Even after finding #1 is fixed, payout amount is derived from client-supplied `usd_amount_cents` and paid unconditionally at `estimated_ngn_amount_minor` — no cross-check against a trusted deposit amount. Amplifies #1 (attacker can also inflate payout), and is a standalone reconciliation gap.
- **Fix:** Re-verify actual settled amount from a trusted source before payout; reconcile against quote within tolerance; flag mismatches for manual review.
- **Effort:** M

### 3. [HIGH] Container runs as root with a direct decode path to the treasury signing keypair
- **Domain:** infra (trivy DS-0002, checkov CKV_DOCKER_3)
- **Location:** `Dockerfile:27-49` (no `USER` directive), `ops/entrypoint.sh:20-30`
- **Confidence:** Confirmed — this pass sharpens the finding: the entrypoint decodes `CLEAR_MSIG_KEYPAIR_BASE64`/`CLEAR_MSIG_SIGNER_BASE64` (the actual treasury payer/signer private keys) to `/tmp/payer.json`/`/tmp/signer.json`, `chmod 600` but root-owned. Any RCE in the Rust HTTP service is root in the container with direct read access to the live signing key — no privilege-escalation step needed.
- **Fix:** Non-root `USER` in the runtime stage; ensure entrypoint's write paths are owned by that user; add a `HEALTHCHECK`.
- **Effort:** S

### 4. [HIGH] Lifecycle scripts unrestricted in npm install (CI and local)
- **Domain:** supply chain
- **Location:** `.github/workflows/ci.yml:83` (`npm ci`, no `--ignore-scripts`), confirmed live example: `frontend/node_modules/bigint-buffer/package.json` `"install"` script → `node-gyp rebuild`
- **Confidence:** Confirmed
- **Impact:** Any compromised/malicious npm package can execute arbitrary code at install time in CI and on developer machines — the single highest-leverage supply-chain gap, independent of whether any currently-resolved package is malicious today.
- **Fix:** `frontend/.npmrc` with `ignore-scripts=true`; CI `npm ci --ignore-scripts`; explicit allowlisted rebuild step for packages needing native builds (`bigint-buffer`, `bufferutil`, `utf-8-validate`, `sharp`).
- **Effort:** S–M (needs testing that native-build packages still work)

### 5. [HIGH] `axios` floating across three resolved versions in the browser wallet-signing bundle — reachability confirmed
- **Domain:** supply chain
- **Location:** `frontend/package-lock.json` — `axios@1.9.0/1.13.2/1.15.0`, traced via `npm ls axios` through `@dynamic-labs/sdk-react-core@4.79.0` → `@dynamic-labs-wallet/*` (multiple nested `core` versions 0.0.167/0.0.203/0.0.259/0.0.325)
- **Confidence:** Confirmed reachable in production browser bundle, not a dev-only diamond dependency.
- **Impact:** Each pre-patch axios version carries known SSRF-via-baseURL-bypass, credential-leakage-on-redirect, and ReDoS issues in code that runs client-side wallet operations.
- **Fix:** `npm overrides` in `frontend/package.json` to force a single patched axios resolution; file upstream issue against `@dynamic-labs-wallet` to collapse `core` versions; verify wallet SDK still functions after override.
- **Effort:** S (override) + follow-up upstream coordination

### 6. [MEDIUM] CI doesn't gate deploys, and CI doesn't scan the highest-value code — compounding gap
- **Domain:** infra + supply chain (independently flagged)
- **Location:** `render.yaml:22-25` (`autoDeployTrigger: commit`, deploys on every push to `main` regardless of CI outcome); `.github/workflows/security.yml:1-51` (CodeQL restricted to `javascript-typescript` only — zero Rust analysis; no `cargo audit`/`cargo deny`/osv-scanner/trivy step; no secret-scanning step in CI)
- **Confidence:** Confirmed
- **Impact:** A commit that fails clippy/tests/CodeQL — or a malicious commit from a compromised maintainer token — can reach production before or without any CI signal, AND the code most likely to matter here (the Rust backends and on-chain program) is never scanned by the one security workflow that exists. These two gaps compound: even if `security.yml` were made a required check, it still wouldn't catch a Rust-side vulnerability.
- **Fix:** Make specific check names (not "all checks," which includes unrelated Dependabot jobs) required on `main` branch protection, then switch Render to `checksPass`. Add Rust SAST/dependency scanning (`cargo audit`/`cargo deny` or a Rust CodeQL pass) to `security.yml`.
- **Effort:** S (branch protection config) + M (Rust CI scanning)

### 7. [MEDIUM] GitHub Actions pinned to mutable refs, incl. one with a live deploy token in scope
- **Domain:** supply chain + infra (both flagged)
- **Location:** `superfly/flyctl-actions/setup-flyctl@master` (`deploy-fly.yml:34`, runs with `FLY_API_TOKEN` in scope — worst case, floats on branch HEAD); `dtolnay/rust-toolchain@stable`, `actions/*@v4`-style tags repo-wide (lower risk)
- **Confidence:** Confirmed
- **Fix:** SHA-pin `flyctl-actions` at minimum; consider repo-wide SHA-pinning for a wallet product.
- **Effort:** S

### 8. [MEDIUM] `curl | sh` installers without checksum verification, one with a deploy token in the same job
- **Domain:** supply chain
- **Location:** `deploy-railway.yml:38` (runs alongside `RAILWAY_TOKEN`), `ci.yml:133` (Solana/Agave CLI, build-time only, lower blast radius)
- **Confidence:** Confirmed. Good contrast in the same repo: `ci.yml`'s Quasar CLI install is already correctly SHA-pinned via `cargo install --git ... --rev <sha>` — use as the template.
- **Fix:** Replace both with checksum-verified downloads or pinned release archives.
- **Effort:** S

### 9. [NEEDS-VERIFICATION, treat as prominent] `@encrypt.xyz/pre-alpha-solana-client@0.1.1` + vendored `@ika.xyz` sibling
- **Domain:** supply chain
- **Location:** `frontend/package.json:28`, referenced in `clearsign.rs` (`hash_private_escrow_*`); vendored sibling at `frontend/src/lib/ikavery/`
- **Confidence:** Needs verification — no confirmed malicious behavior, but the trust profile is genuinely unusual: single maintainer (`omersadika@dwalletlabs.com`), 2 published versions ~2 months old, ~103 downloads/30 days, used for **confidential escrow/policy crypto operations** in a multisig wallet. No install-time lifecycle hooks and no `binding.gyp` were found (reduces, but does not eliminate, concern). The sibling `@ika.xyz` package is **vendored source, not installed** — absent from `package.json`/`package-lock.json` entirely, sidestepping lockfile integrity checks with no automated verification against upstream.
- **What would confirm/deny:** manual review of the unpacked `@encrypt.xyz` tarball source for exfiltration code; diff the vendored `@ika.xyz` copy against its upstream publish; confirm maintainer 2FA where checkable.
- **Fix direction:** exact-pin `@encrypt.xyz` (currently floating `^`); treat as a trust/blast-radius policy decision for the team, not a code fix.
- **Effort:** S (review)

### 10. [MEDIUM/needs-verification cluster] Rust dependency CVEs — incomplete this pass, prioritize crypto-path crates
- **Domain:** supply chain
- **Location:** root and `rust-settlement` `Cargo.lock`
- **Confidence:** **Needs verification — not confirmed current.** Tooling (syft/grype) hung and was killed this pass; no fresh osv-scanner run; no `cargo-audit` available in this environment. The list below is carried over from a prior scan and must be re-run before acting on it as-is.
- Carried-over candidates worth prioritizing for re-scan, in order: `ed25519-dalek 1.0.1` (RUSTSEC-2022-0093, double-public-key signing oracle — **directly in this wallet's signature-verification path, escalate regardless of raw CVSS**), `curve25519-dalek 3.2.0` (RUSTSEC-2024-0344), `libsecp256k1 0.6.0` (RUSTSEC-2025-0161) — all three sit in the crypto-critical signature path; then `openssl 0.10.77/0.10.79`, `quinn-proto 0.11.13`, `rustls-webpki 0.101.7/0.103.9`, `ws 8.20.0`, `jsonwebtoken 8.3.0`, `rand`.
- **Fix:** Re-run `syft`/`grype` scoped per-lockfile (not full directory walk) or `cargo audit`/`cargo deny` in a clean environment; run `cargo tree --invert` for `openssl`/`rustls-webpki`/`quinn-proto` reachability before treating any as confirmed-exploitable.
- **Effort:** S (re-scan) + variable per finding once confirmed

### 11. [MEDIUM, needs-verification] Non-constant-time Paystack HMAC comparison
- **Domain:** appsec + identity (both flagged)
- **Location:** `rust-settlement/src/paystack/signature.rs:37` — `if expected == provided_lower` (hex-string equality). Kora correctly uses `mac.verify_slice` (constant-time) at `kora/signature.rs:28`.
- **Confidence:** Confirmed as written; exploitability low (network jitter dominates timing side-channels over HTTP), still worth fixing for defense-in-depth.
- **Fix:** Use a constant-time byte comparison (`subtle`/`ct_codecs`) instead of string `==`.
- **Effort:** S

### 12. [LOW] `workflow_dispatch` inputs interpolated directly into shell
- **Domain:** infra
- **Location:** `deploy-fly.yml:40-44`, `deploy-railway.yml:45-49` (checkov CKV_GHA_7)
- **Confidence:** Confirmed. Bounded exposure — requires write access to trigger — but needlessly expands blast radius if a collaborator account/PAT is compromised, since the job holds `FLY_API_TOKEN`/`RAILWAY_TOKEN`.
- **Fix:** Move inputs to `env:`, reference via `"$APP"` in the shell.
- **Effort:** S

### 13. [INFO] Treasury signer key management: single eternal env-var secret, no rotation/HSM
- **Domain:** identity
- **Location:** `rust-settlement/src/signer/solana.rs:53-78`
- **Impact:** A leak of `TREASURY_SOL_KEYPAIR_BASE58` is a complete, silent, irrevocable treasury compromise. No live secret values found in repo. Already worsened by finding #1, which lets an attacker drive spends through the legitimate signer without ever needing the key.
- **Fix:** KMS/HSM-backed signer or policy-limited co-signer, plus a hard per-tx/per-day spend cap enforced independently of ramp-intent business logic.
- **Effort:** L

### 14. [INFO] `ci.yml` missing explicit `permissions:` block
- **Domain:** infra
- **Location:** `.github/workflows/ci.yml` (checkov CKV2_GHA_1)
- **Fix:** Add `permissions: contents: read` at workflow or job level.
- **Effort:** S

### 15. [INFO — positive finding] On-chain policy engine and ClearSign v2 envelope reviewed and found sound
- **Domain:** appsec
- **Location:** `programs/clear-wallet/src/utils/{policy.rs, advanced_policy.rs, clearsign.rs, message.rs}`, `state/typed_proposal.rs:392-439`
- This was previously the largest unknown in the codebase and it held up under review this pass: bounds-checked parsing throughout (`checked_add`/`checked_mul`, explicit length checks before slice access); `unsafe` casts in `bytes_to_keys`/`keys` are sound; the rule-effect parser fails closed on all malformed/unknown input; ClearSign v2 hash-binding is verified server-side against a deterministic reconstruction of the signed message (no WYSIWYS divergence possible); domain-separated hashes prevent cross-action collisions. `signer/solana.rs` fails loudly (unimplemented, not silently mishandled) for SPL transfers.

## Needs verification

| # | Finding | What would confirm it |
|---|---|---|
| 1 | Rust CVE list (finding #10) | Re-run `syft`/`grype` or `cargo audit`/`cargo deny` scoped per-lockfile in an environment without the tooling hang seen this pass; `cargo tree --invert` for openssl/rustls-webpki/quinn-proto reachability |
| 2 | `@encrypt.xyz`/`@ika.xyz` trust profile (finding #9) | Manual tarball source review for exfiltration code; diff vendored `@ika.xyz` against upstream publish; confirm maintainer 2FA where checkable |
| 3 | Kora webhook HMAC computed over re-serialized `data` subset, not raw payload | Confirm against Kora's spec whether it signs `data` only or full raw body; check whether unsigned `event_type` driving payout/payment branches is a manipulable trust gap |
| 4 | `backend-api` validation/rate-limit/CORS coverage across every route | Full route-by-route enumeration confirming middleware attachment (on-chain program independently re-verifies ClearSign signatures, so this is a defense-in-depth gap, not a bypass of authorization) |
| 5 | `backend-api/src/cors.rs` permissive fallback (`CorsLayer::permissive()`) in misconfigured environments | Confirm production always sets `CLEAR_MSIG_ALLOWED_ORIGIN`; recommend fail-closed regardless |
| 6 | `AgentTradeSettlement` replay-safety against oracle price manipulation | Full trace of settlement instruction handlers for staleness/replay protection — not completed by appsec or identity this pass |
| 7 | Branch protection required-status-check configuration for `main` | Inspect via authenticated `gh` / repo admin settings — not accessible from this audit environment |
| 8 | `git log -p -S 'PRIVATE KEY'` full history scan | Not run this pass; working-tree and full-history gitleaks scans were clean but a targeted historical grep for rotated-but-committed secrets was not performed |

## Hardening backlog
- Base images tag-pinned, not digest-pinned (`rust:1.95-bookworm`, `debian:bookworm-slim`) — low urgency.
- Add `HEALTHCHECK` to `Dockerfile`.
- Exact-pin `@encrypt.xyz/pre-alpha-solana-client` instead of `^` floating range.
- `.dockerignore`/multi-stage build already correctly minimal — no action needed.
- `render.yaml` secrets already correctly `sync:false` — no action needed.
- `entrypoint.sh` already fails closed on missing Redis creds in production — no action needed, cite as a template for other services.

## Remediation sequence
1. **[Now]** Add auth (shared-secret/HMAC, constant-time compare) to `POST /v1/internal/chain/confirm` — kills finding #1's exploitability immediately, cheapest and highest-impact fix in the repo. (S)
2. **[Now]** Replace `x-user-id` trust with verified session/wallet-signature identity — closes the IDOR half of finding #1 and finding #2's blast radius. (M)
3. **[This week]** Non-root `USER` in Dockerfile runtime stage (finding #3). (S)
4. **[This week]** `--ignore-scripts` in CI + `.npmrc`, `npm overrides` to collapse axios versions (findings #4, #5). (S–M)
5. **[This week]** Reconcile offramp payout amount against a trusted independently-observed deposit (finding #2). (M)
6. **[This week]** SHA-pin `flyctl-actions@master`; replace `curl | sh` installers with checksum-verified downloads (findings #7, #8). (S)
7. **[Backlog]** Add `permissions:` block to `ci.yml`; fix `workflow_dispatch` shell interpolation; move Paystack HMAC to constant-time compare. (S each)
8. **[Backlog]** Add Rust SAST/dependency scanning to `security.yml`; make specific checks required on `main`; switch Render to `checksPass` (finding #6). (M)
9. **[Backlog]** Re-run Rust dependency CVE scan in a clean environment; escalate `ed25519-dalek`/`curve25519-dalek`/`libsecp256k1` findings first if confirmed (finding #10). (S to re-scan, variable after)
10. **[Backlog/project]** KMS/HSM-backed treasury signer with independent spend caps (finding #13). (L)
11. **[Backlog]** Manual source review of `@encrypt.xyz`/`@ika.xyz` and decide on continued use (finding #9). (S)

## What was NOT audited
- Runtime/DAST against the live Render deployment — no live traffic/exploitation testing performed.
- Third-party service internals (Dynamic Labs WaaS backend, Ledger firmware, Paystack/Kora infrastructure) — only the integration points in this repo were reviewed.
- EVM/Bitcoin/Zcash signer paths in `rust-settlement` — only the Solana signer was reviewed in depth.
- Frontend Dynamic Labs/Ledger token storage and client-side session handling.
- `backend-api/src/{proposals,intents}.rs` route-level auth beyond wallet membership lookup.
- `AgentTradeSettlement` oracle-price replay/staleness logic.
- CLI (`cli/src`) and mobile wrapper (android/ios) code.
- Full `git log -p` historical secret scan (only working-tree + full-history gitleaks pattern scan was run).
- GitHub org/repo-level branch protection and required-status-check configuration (no `gh` auth in this environment).
