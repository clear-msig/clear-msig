# Repository separation plan

This is a migration plan, not an instruction to rely on source privacy for
authorization. The protocol must remain secure when every repository is public.

## Proposed repositories

| Repository | Visibility | Contents |
| --- | --- | --- |
| `clearsig-protocol` | Public | Solana program, public client, canonical intent schema, deterministic serialization, public test vectors, SDK contracts |
| `clearsig-web` | Public or source-available | Next.js presentation, wallet adapters, generated public schemas, product UI |
| `clearsig-services` | Private | Backend orchestration, anti-abuse logic, internal execution operations, infrastructure manifests |
| `clearsig-settlement` | Private and isolated | Fiat providers, payout workers, custodial signers, database migrations |
| `clearsig-state-proof` | Private if implemented | Proprietary proof generation; only public verification contracts/vectors leave the repository |

## Shared contract strategy

1. Version canonical intent and API schemas independently from application
   releases.
2. Publish immutable Rust crates and generated TypeScript artifacts from tagged
   protocol releases.
3. Check generated files against source vectors in CI; never edit them by hand.
4. Keep API compatibility tests in both service and web repositories.
5. Pin generated clients to a program release and program ID/environment map.

## Current extraction readiness

The in-repository mechanical phase is complete:

- runnable applications are under `apps/`;
- reusable Rust contracts are under `crates/`;
- the Solana program and generated client have one owner under `programs/`;
- browser and trusted-service source-import boundaries are CI-enforced;
- settlement remains a standalone Cargo workspace;
- Vercel, Railway, Docker, CI, scripts, and documentation use the new paths.

The repositories themselves have not been created or made private. That step
requires owner-approved destination organizations, access lists, deployment
credentials, package publication, and history policy. Existing public Git
history cannot be made secret by moving future commits.

## Remaining extraction order

1. Tag the v4 protocol crates and generated client as the extraction baseline.
2. Authenticate and isolate `apps/settlement`; remove frontend dependency on
   self-asserted identity.
3. Extract protocol crates and generated artifacts with immutable package
   versions and checksum verification.
4. Move settlement first because it already has a standalone Cargo workspace.
5. Move backend services and infrastructure after API contract tests pass.
6. Move the web application last, replace relative contracts with pinned
   packages, and remove the temporary `frontend` Vercel symlink.

## CI/CD and secrets

- Build protocol artifacts once and verify checksums in downstream repositories.
- Require code-owner review for program, canonical intent, signing, execution,
  deployment, and generated-client paths.
- Use environment-scoped deployment identities. Do not share Vercel, Railway,
  program-upgrade, or settlement credentials across repositories.
- Keep real secrets out of examples and source defaults. Secret scanners must
  cover current trees and history on every repository.
- Pin third-party workflow actions and installers by immutable revision where
  practical.

## Review protection recommendations

- Require pull requests, passing CI/security checks, signed commits where the
  team can support them, and dismissal of stale approvals on protected release
  branches.
- Require at least two independent reviewers for `programs/clear-wallet/`,
  `crates/clear-msig-signing/`, execution adapters, backend lifecycle code,
  deployment workflows, and generated protocol artifacts.
- Keep CODEOWNERS coverage on those paths and disallow administrators from
  bypassing required checks for production releases.
- Keep dependency updates deliberate and tested. Automated update PRs are
  currently disabled, so a named maintainer must triage alerts on a fixed
  cadence and record accepted risk.

## Rollback

Every split must leave the previous monorepo release deployable until the new
repository has passed contract tests and a production smoke. Roll back by
restoring the prior deployment artifact, not by force-pushing source history.
