# Infra, Container & CI/CD Findings (post-pull)

## Confirmed

### [HIGH] Container runs as root — no `USER` directive, and treasury keypair material is decoded into that root-owned filesystem
- **OWASP:** A02:2025
- **Location:** `Dockerfile:27-49` (runtime stage), materialized by `ops/entrypoint.sh:20-30`
- **Tool:** trivy config DS-0002 (HIGH) + checkov CKV_DOCKER_3, both independent.
- `clear-msig-backend-api` runs as root; entrypoint decodes `CLEAR_MSIG_KEYPAIR_BASE64`/`CLEAR_MSIG_SIGNER_BASE64` (Solana payer + signer private keys) to `/tmp/payer.json`/`/tmp/signer.json`, `chmod 600` but root-owned. Any RCE in the Rust HTTP service is root inside the container with direct read access to the live signing keypair — no privilege-escalation step needed.
- **Fix:** non-root `USER` in runtime stage, ensure entrypoint's write paths are owned by that user, add a `HEALTHCHECK`.

### [MEDIUM] `render.yaml` deploys on every push to `main` without waiting for CI results (`autoDeployTrigger: commit`)
- **Location:** `render.yaml:22-25`
- Inline comment documents the tradeoff: `checksPass` was rejected because it waits for *every* GitHub check including unrelated Dependabot jobs, so the team switched to `autoDeployTrigger: commit` — deploys the instant a commit lands on `main`, independent of whether `ci.yml`/`security.yml` passed or even finished. Branch protection gates merges into `main`, not what Render does after merge, and does nothing for direct pushes if allowed.
- **Impact:** a commit that fails clippy/tests or trips CodeQL — or an intentionally malicious commit from a phished/compromised maintainer token — can reach production (`clear-msig-backend.onrender.com`) before or without any CI signal, no rollback gate.
- **Fix:** make specific check names (not "all checks") required on `main` branch protection (e.g. only `ci.yml`'s host-checks job), then switch Render to `checksPass` — gets deploy-blocking without being held hostage by unrelated Dependabot jobs. At minimum, document this as an accepted risk decision.

## Needs verification

### [MEDIUM] `security.yml` CodeQL/dependency-review results not confirmed to be required merge checks; Rust code entirely unscanned by it
- **Location:** `.github/workflows/security.yml:1-51`
- New workflow. Runs CodeQL (`languages: javascript-typescript` ONLY — no Rust analysis for backend-api/rust-settlement/on-chain program) + `dependency-review-action` (PR-only, `fail-on-severity: high`). CodeQL posts to Security tab but is advisory unless separately required in branch protection — could not verify branch-protection config from this environment (no `gh` auth).
- **Coverage gap:** the two highest-value attack surfaces (Rust backends + on-chain program) are unscanned by this workflow. If there's an expectation that `security.yml` covers the whole app, it doesn't — would need `cargo audit`/`cargo deny` or a Rust CodeQL pass.
- **Fix:** confirm `dependency-review` (already correctly blocking) and ideally a CodeQL gate are required checks; add Rust SAST/dependency scanning to close the coverage gap.

### [LOW] `workflow_dispatch` inputs interpolated into shell in manual deploy workflows
- **Location:** `deploy-fly.yml:40-44`, `deploy-railway.yml:45-49` (checkov CKV_GHA_7)
- `${{ inputs.app }}`/`${{ inputs.service }}` interpolated directly into `run:` rather than via `env:`. Bounded exposure (`workflow_dispatch` requires write access to trigger, not external/fork actors) but needlessly expands blast radius if a collaborator account/PAT is compromised — job holds `FLY_API_TOKEN`/`RAILWAY_TOKEN`.
- **Fix:** move inputs to `env:`, reference as `"$APP"` in the shell.

## Informational / hardening
- Base images tag-pinned not digest-pinned (`rust:1.95-bookworm`, `debian:bookworm-slim`) — lower urgency, official images with reasonable provenance.
- GitHub Actions on mutable tags across all workflows; **`superfly/flyctl-actions/setup-flyctl@master`** in `deploy-fly.yml:34` floats on branch HEAD — weakest link, prioritize if SHA-pinning any.
- `ci.yml` has no explicit `permissions:` block (checkov CKV2_GHA_1) — inherits repo/org default `GITHUB_TOKEN` scope though the job doesn't need write access. Add `permissions: contents: read`.
- `Dockerfile` has no `HEALTHCHECK` (checkov CKV_DOCKER_2) — combined with the `autoDeployTrigger: commit` finding, less of a safety net at container level (Render's platform-level `/health` check partially covers this).
- **`entrypoint.sh` is otherwise sound:** `set -euo pipefail`, no secret values echoed (only paths/URLs/mode strings), keypair files `chmod 600`, hard-fails if `CLEAR_MSIG_ENV=production` without Redis creds configured — good fail-closed design.
- `fly.toml`/`railway.json` contain no plaintext secrets — comment blocks only show local `fly secrets set` commands, not key material.
- `.dockerignore` correctly excludes `.git/`, `.github/`, `node_modules/`, `.env*`, `target/`; multi-stage build correctly limits the runtime image to compiled binary + entrypoint + examples, no toolchain/source tree.
- `render.yaml` secrets all correctly `sync:false`, including the newly-added ones — no secret sprawl issue.
- **Deployment target confirmed:** Render is live (`smoke-live.yml` defaults to `clear-msig-backend.onrender.com`); Fly/Railway are documented manual/alternative force-redeploy paths.

## Coverage
- **Tools run:** `trivy config --severity HIGH,CRITICAL` (repo-wide), `checkov -f Dockerfile`, `checkov -d .github/workflows`.
- **Checked:** Dockerfile, `ops/entrypoint.sh`, `render.yaml`, `fly.toml`, `railway.json`, `.dockerignore`, all 6 workflow files (including new `security.yml`).
- **Not applicable:** no K8s/Terraform/docker-compose in repo.
- **Not verifiable from this environment:** actual GitHub branch-protection required-status-check config for `main` (no `gh` auth available).
