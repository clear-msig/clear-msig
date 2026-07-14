# clear-msig Security Remediation Plan

Companion to `.audit/ADVISORY.md` (full findings, evidence, confidence levels). This file is
the **build doc** — one task per finding, file-level, ready to hand to an engineer or an
agent. Read-only audit; none of these changes have been applied yet.

Severity/effort tags carried over from the advisory. Work top to bottom — later items assume
earlier ones are done where noted.

---

## P0 — Do first (fund-theft path)

### T1. Auth-gate `/v1/internal/chain/confirm`
- **File:** `rust-settlement/src/http/handlers.rs:65` (route), `:500-556` (`chain_confirm` handler), `:50-69` (`build_router`), `rust-settlement/src/main.rs:103-105` (middleware stack)
- **Problem:** Route has zero authentication. Anyone can POST a fabricated `ChainTransferConfirmationRequest{finalized: true}` for an `intent_id` they created, which flows through `workers/chain_confirmation.rs` → `workers/payout_dispatch.rs` and fires a real Paystack/Kora bank payout with no crypto ever received.
- **Fix:**
  1. Add a shared-secret or HMAC auth check on this route (mirror the pattern already used correctly for `/v1/webhooks/kora` — `mac.verify_slice`, constant-time). A static internal bearer token checked via `axum::middleware::from_fn`, scoped only to this route, is sufficient for a first pass.
  2. Better, if time allows: replace the push model with a pull model — have the service itself query Solana RPC / an indexer for the deposit rather than trusting a caller-submitted `finalized`/`tx_hash`/`amount_minor`. This also fixes T2 below for free.
  3. If keeping the push model for now, at minimum verify the submitted `tx_hash` against chain RPC and cross-check `amount_minor`/`sender_wallet` against the intent's expected values before setting `is_finalized = true`.
- **Effort:** S (shared-secret gate) / L (pull-model rewrite)
- **Verify:** attempt the exploit — POST to `/v1/internal/chain/confirm` without credentials should now 401/403; with a forged-but-unauthenticated request the intent must not reach `settlement_completed`.

### T2. Reconcile payout amount against actual confirmed transfer
- **File:** `rust-settlement/src/contracts/api.rs:22-35`, `rust-settlement/src/services/intents.rs:88-236`, `rust-settlement/src/workers/webhook_processing.rs:172-200`, `rust-settlement/src/workers/payout_dispatch.rs`
- **Problem:** The NGN amount paid out is `ramp_quotes.estimated_ngn_amount_minor`, computed from client-supplied `usd_amount_cents` at intent-creation time, and is **never** re-verified against what was actually confirmed received. Even after T1 is fixed, this is a standalone reconciliation gap.
- **Fix:** Before `payout_dispatch` calls `payment_provider.initiate_payout`, re-derive the expected NGN amount from the actually-confirmed on-chain amount (post-T1, this is RPC-verified) and compare against the quoted amount within a tolerance band. Reject/flag-for-manual-review on mismatch instead of paying unconditionally.
- **Effort:** M
- **Depends on:** T1 (need a trustworthy "actually confirmed" amount to reconcile against)

### T3. Replace `x-user-id` header trust with verified identity
- **File:** `rust-settlement/src/http/handlers.rs:37-44` (`user_id_from_headers`), call sites: `create_intent` (:87-99), `get_intent` (:170), `prepare_signature` (:217), `initialize_payment` (:270); `rust-settlement/src/services/intents.rs:347` (ownership check)
- **Problem:** `x-user-id` is a self-asserted UUID header with no session/JWT/signature backing it. Any caller can impersonate any other user's ramp intents (read, advance, pay).
- **Fix:** Introduce a verified identity layer — either (a) a session token issued after a wallet-signature challenge, validated server-side and mapped to `user_id`, or (b) if the frontend already gets a Dynamic Labs WaaS session, validate that session's claims server-side per request. Derive `user_id` from the verified identity, never from a client header. Reject requests with no valid credential before the handler runs (use `axum::middleware::from_fn` applied to the whole `/v1/ramp/*` router group, not per-handler).
- **Effort:** M
- **Verify:** setting `x-user-id` to an arbitrary UUID with no valid session must be rejected; a caller can only ever act on intents tied to their own verified identity.

---

## P1 — This week

### T4. Non-root container user
- **File:** `Dockerfile:27-49` (runtime stage), `ops/entrypoint.sh:20-30`
- **Problem:** No `USER` directive — the process, including decode of `CLEAR_MSIG_KEYPAIR_BASE64`/`CLEAR_MSIG_SIGNER_BASE64` to `/tmp/payer.json`/`/tmp/signer.json`, runs as root. Any RCE is immediate key theft.
- **Fix:**
  ```dockerfile
  RUN useradd -r -u 10001 clearmsig
  # ensure /app, /data, and any path entrypoint.sh writes to are owned by clearmsig
  USER clearmsig
  ```
  Verify `ops/entrypoint.sh`'s `/tmp` writes and `chmod 700` attestation-dir creation still work under the new UID (pre-create/chown in the Dockerfile if needed).
- **Effort:** S
- **Verify:** `docker run --rm <image> whoami` should not print `root`; entrypoint should complete a normal boot without permission errors.

### T5. Disable npm lifecycle scripts in CI and locally
- **File:** new `frontend/.npmrc`, `.github/workflows/ci.yml:83`
- **Problem:** No `.npmrc` exists; CI runs plain `npm ci`. Any compromised package's `preinstall`/`postinstall`/`install` script executes with CI-runner or developer-machine privileges. Confirmed live example: `bigint-buffer`'s `install` script runs `node-gyp rebuild`.
- **Fix:**
  1. `frontend/.npmrc`:
     ```
     ignore-scripts=true
     ```
  2. `.github/workflows/ci.yml:83`: change `npm ci` to `npm ci --ignore-scripts`.
  3. Add an explicit, reviewed rebuild step for packages that need native builds: `npm rebuild bigint-buffer bufferutil utf-8-validate sharp` run right after install, so these are visible and auditable rather than implicit.
- **Effort:** S–M (test that the app still builds/runs with scripts disabled)
- **Verify:** `npm ci` in `frontend/` completes and the app still builds; native modules (`bigint-buffer` etc.) still function at runtime.

### T6. Collapse floating `axios` versions in the wallet-signing bundle
- **File:** `frontend/package.json` (add `overrides`), `frontend/package-lock.json` (will regenerate)
- **Problem:** `axios@1.9.0`/`1.13.2`/`1.15.0` all resolve, confirmed reachable via `@dynamic-labs/sdk-react-core` → `@dynamic-labs-wallet/*`. Each pre-patch version carries known SSRF/credential-leak/ReDoS issues, running in the browser wallet-signing path.
- **Fix:**
  ```json
  "overrides": {
    "axios": "^1.15.0"
  }
  ```
  (or the latest patched 1.x at fix time). Regenerate `package-lock.json`, then manually exercise every Dynamic Labs wallet flow (connect, sign, send) to confirm nothing broke under the forced version.
- **Effort:** S (override) + verification time
- **Verify:** `npm ls axios` shows a single resolved version; wallet connect/sign/send flows still work end-to-end.

### T7. Reconcile deploy gating and CI security coverage
- **File:** `render.yaml:22-25` (`autoDeployTrigger: commit`), `.github/workflows/security.yml` (CodeQL config), GitHub branch protection settings (outside repo)
- **Problem:** Render deploys on every push to `main` regardless of CI outcome. Separately, the one security workflow (`security.yml`) only scans JavaScript/TypeScript — the Rust backends and on-chain program (the highest-value code) are never scanned in CI.
- **Fix:**
  1. In GitHub branch protection for `main`, add a **specific** required status check — e.g. just the `ci.yml` host-checks job — not "all checks" (which would block on unrelated Dependabot jobs, the reason `checksPass` was rejected per the `render.yaml` comment).
  2. Switch `render.yaml`'s `autoDeployTrigger` to `checksPass` once the required check is scoped narrowly.
  3. Add Rust coverage to `security.yml`: a `cargo audit` or `cargo deny` step (or a Rust CodeQL config) across all 5 Cargo workspaces.
- **Effort:** S (branch protection) + M (Rust CI scanning)

### T8. SHA-pin the mutable-ref GitHub Action, fix curl-pipe-shell installers
- **File:** `.github/workflows/deploy-fly.yml:34` (`superfly/flyctl-actions/setup-flyctl@master`), `.github/workflows/deploy-railway.yml:38` (`curl -fsSL https://railway.com/install.sh | sh`), `.github/workflows/ci.yml:133` (Solana/Agave installer)
- **Fix:**
  1. Pin `flyctl-actions` to a release tag at minimum, ideally a commit SHA: `superfly/flyctl-actions/setup-flyctl@<sha> # vX.Y.Z`.
  2. Replace both `curl | sh` installers with a checksum-verified download, or a pinned release archive. Use `ci.yml`'s existing Quasar install (`cargo install --git ... --rev <sha>`) as the pattern to follow.
- **Effort:** S

---

## P2 — Backlog

### T9. Constant-time Paystack HMAC comparison
- **File:** `rust-settlement/src/paystack/signature.rs:37`
- **Fix:** replace `if expected == provided_lower` with `subtle::ConstantTimeEq` or decode both sides and use `hmac::Mac::verify_slice`, matching the pattern already correct in `rust-settlement/src/kora/signature.rs:28`.
- **Effort:** S

### T10. Fix `workflow_dispatch` shell interpolation
- **File:** `.github/workflows/deploy-fly.yml:39-44`, `.github/workflows/deploy-railway.yml:44-49`
- **Fix:** move `${{ inputs.app }}` / `${{ inputs.service }}` into `env:` and reference as `"$APP"`/`"$SERVICE"` inside the `run:` block instead of interpolating the expression directly.
- **Effort:** S

### T11. Add `permissions:` block to `ci.yml`
- **File:** `.github/workflows/ci.yml`
- **Fix:** add `permissions: contents: read` at the top of the workflow.
- **Effort:** S

### T12. Kora webhook HMAC scope
- **File:** `rust-settlement/src/kora/signature.rs:4-29`
- **Problem:** HMAC is computed over a re-serialized `data` sub-object, not the raw request body — `event` (used for dispatch in `workers/webhook_processing.rs:48-57`) is unauthenticated.
- **Fix:** confirm against Kora's webhook-signing spec whether the raw body or just `data` is signed. If raw body, verify against the exact bytes received instead of re-serializing. If `data`-only is correct per spec, extend the MAC'd context to cover `event` as well, or otherwise stop treating unsigned `event` values as trusted for dispatch decisions.
- **Effort:** M (needs Kora spec confirmation first)

### T13. Exact-pin and manually review `@encrypt.xyz/pre-alpha-solana-client`
- **File:** `frontend/package.json:28`, `frontend/src/lib/ikavery/` (vendored `@ika.xyz` sibling)
- **Problem:** Single-maintainer, ~2-month-old, ~100 downloads/month, used for confidential escrow/policy crypto operations. Sibling package is vendored source (not installed), bypassing lockfile integrity entirely.
- **Fix:** Change `"@encrypt.xyz/pre-alpha-solana-client": "^0.1.1"` to an exact pin `"0.1.1"`. Manually review the unpacked tarball source for both packages for anything unexpected before relying on them further; diff the vendored `@ika.xyz` copy against its published upstream. This is a product/trust decision as much as a code fix — flag to whoever owns the escrow feature.
- **Effort:** S (pin) + review time

### T14. Rust dependency CVE re-scan
- **File:** all 5 `Cargo.lock` files
- **Problem:** syft/grype hung during the audit and were killed; no fresh scan completed. Carried-over candidates from a prior scan, in priority order (crypto-path crates first): `ed25519-dalek 1.0.1` (RUSTSEC-2022-0093), `curve25519-dalek 3.2.0` (RUSTSEC-2024-0344), `libsecp256k1 0.6.0` (RUSTSEC-2025-0161), then `openssl 0.10.77/0.10.79`, `quinn-proto 0.11.13`, `rustls-webpki 0.101.7/0.103.9`, `ws 8.20.0`, `jsonwebtoken 8.3.0`, `rand`.
- **Fix:** Run `cargo audit` or `cargo deny check` (or `grype` scoped to one lockfile path at a time, not a full directory walk) in a clean environment. For anything flagged, run `cargo tree --invert -p <crate>` from the relevant workspace to confirm it's actually linked into the shipped binary before prioritizing a fix.
- **Effort:** S (re-scan) + variable per confirmed finding

### T15. KMS/HSM-backed treasury signer
- **File:** `rust-settlement/src/signer/solana.rs:53-78`
- **Problem:** Treasury private key lives as a single plaintext env var, no rotation, no independent spend cap.
- **Fix:** Move signing to a KMS/HSM-backed service or a policy-limited co-signer, and add a hard per-transaction / per-day spend cap enforced independently of the ramp-intent business logic (so even a fully-compromised app can't move more than the cap in a day).
- **Effort:** L — treat as a project, not a quick patch

---

## Task index (for tracking)

| # | Title | Severity | Effort | Depends on |
|---|---|---|---|---|
| T1 | Auth-gate chain-confirm endpoint | CRITICAL | S/L | — |
| T2 | Reconcile payout amount | part of CRITICAL | M | T1 |
| T3 | Verified user identity, drop `x-user-id` trust | CRITICAL | M | — |
| T4 | Non-root container | HIGH | S | — |
| T5 | `--ignore-scripts` in npm | HIGH | S–M | — |
| T6 | Collapse axios versions | HIGH | S | — |
| T7 | CI gating + Rust scanning | MEDIUM | S+M | — |
| T8 | SHA-pin actions, fix curl\|sh | MEDIUM | S | — |
| T9 | Constant-time Paystack HMAC | MEDIUM | S | — |
| T10 | Fix workflow_dispatch injection | LOW | S | — |
| T11 | `ci.yml` permissions block | INFO | S | — |
| T12 | Kora HMAC scope | needs-verification | M | — |
| T13 | Pin/review pre-alpha escrow dep | needs-verification | S | — |
| T14 | Rust CVE re-scan | needs-verification | S+ | — |
| T15 | KMS/HSM treasury signer | INFO | L | — |

---

## Prompt for implementing agent (Claude Code / harness workflow)

Paste this as the task brief for the harness agent. It's self-contained — the agent doesn't
need this conversation's context, only this repo and the two audit files below.

```
You are implementing security fixes for the clear-msig repository (a Solana multisig wallet
product: on-chain program in programs/clear-wallet, two Rust/Axum backends — backend-api and
rust-settlement — and a Next.js frontend). A read-only security audit was already performed;
you are implementing its recommendations, not re-auditing from scratch.

Read these two files first, in full, before touching any code:
  1. .audit/ADVISORY.md — the full findings with evidence and confidence levels
  2. .audit/REMEDIATION.md — this task breakdown (T1-T15), which is your worklist

Work through the tasks in T1..T15 order — the numbering reflects severity and dependency
order (T1-T3 are a fund-theft path and must land first; T2 depends on T1). For each task:

  - Re-verify the finding against the CURRENT code before fixing it (file:line references
    may have drifted since the audit; confirm the vulnerable pattern is still there).
  - Make the minimal correct change described in REMEDIATION.md's "Fix" section. Don't
    refactor beyond what's needed to close the finding.
  - After each fix, state how you verified it (test run, manual exploit attempt that now
    fails, `cargo check`/`npm run build` passing, etc.) — REMEDIATION.md's "Verify" lines
    are the bar, not just "it compiles."
  - Tasks marked "needs-verification" in the advisory (T12, T13, T14) require you to first
    resolve the open question stated (e.g. confirm Kora's signing spec, run a dependency
    scan) before deciding whether code needs to change at all — don't guess.
  - T15 is a project-sized change (KMS/HSM integration) — if you reach it, stop and propose
    an implementation plan rather than writing it unprompted; this one needs a design
    decision from the team first.

Do not create new abstractions beyond what each fix needs. Do not touch files outside what
each task specifies unless a fix genuinely requires it (e.g. T3's session-identity change
will need at least one new small module — keep it scoped to rust-settlement's auth layer,
don't refactor backend-api's separate auth model, which was reviewed and found sound).

When you finish each task, mark it done and move to the next. If you get blocked on a task
(missing spec, ambiguous requirement, needs a product decision), say so explicitly and move
to the next unblocked task rather than guessing at intent for a fund-movement-critical fix.
```
