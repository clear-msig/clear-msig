# Repository map

Status: updated during the ClearSign v4 binding hardening worktree. Local
validation completed on 2026-07-16; deployment and external review are pending.

This document describes code that exists today. It does not imply that every
component is production ready or currently deployed.

## Runtime and package inventory

| Path | Owner/runtime | Build system | Status | Security sensitivity | Direct consumers |
| --- | --- | --- | --- | --- | --- |
| `apps/web/` | Next.js web and same-origin API routes | npm, Next.js, TypeScript | Deployed to Vercel | High: wallet signing, proposal preparation, server routes | Browsers, Vercel |
| `apps/api/` | Axum relayer and trusted preparation API | root Cargo workspace | Deployed to Railway | Critical: canonical preparation, relaying, destination delivery | Frontend backend proxy |
| `apps/settlement/` | Axum/Postgres fiat settlement and custodial signers | standalone Cargo workspace | Active code, not in the current Railway image | Critical: bank payouts and hot-wallet keys | Frontend ramp client, operators |
| `programs/clear-wallet/` | Solana program | Quasar/SBF and Cargo tests | Active, deployed on devnet | Critical authorization boundary | Execution crate, client, E2E, frontend mirrors |
| `programs/clear-wallet/client/` | Program client and intent builder | root Cargo workspace | Active | High: instruction and PDA construction | Execution crate, program tests, E2E |
| `crates/clear-msig-command-contract/` | Transport-independent command types | root Cargo workspace | Active | High: backend/execution boundary | Backend, execution crate |
| `crates/clear-msig-execution/` | Solana/Ika/destination execution library | root Cargo workspace | Active | Critical: execution and broadcast | Backend, CLI |
| `crates/clear-msig-intent/` | Versioned transaction-template definitions | root Cargo workspace | Active but incomplete for approval intents | Critical after binding migration | Execution, program client, E2E, generated frontend artifacts |
| `crates/clear-msig-signing/` | Canonical approval schema, codec, commitments, rendering, and device profiles | root Cargo workspace, no-std compatible | Active v4 authority library | Critical | Backend, execution, Solana program |
| `apps/cli/` | Thin operator binary | root Cargo workspace | Active | High: permissionless lifecycle and execution | Operators, release workflow |
| `apps/e2e/` | Live/testnet qualification binaries | root Cargo workspace | Active test support | High | Manual and CI-adjacent verification |
| `deps/solana-curve25519/` | Vendored patched dependency | Cargo patch | Active | High: cryptographic dependency | Root workspace resolution |
| `examples/` | Intent fixtures and agent integration examples | Mixed | Active fixtures/examples | Medium; some examples handle test keys | Tests, Docker image, operators |
| `scripts/` | Architecture, deploy, smoke, and bootstrap tooling | shell | Active, mixed maturity | High for deploy scripts | CI and operators |
| `ops/` | Container entrypoint | shell/Docker | Active on Railway | Critical: materializes signer secrets | Docker runtime |
| `.github/` | CI, release, security, Railway deploy workflows | GitHub Actions | Active | High: supply chain and deployments | GitHub |
| `.audit/` | Independent security evidence | Markdown | Historical snapshot; findings require revalidation | High | Maintainers |
| `docs/`, `posts/` | Product, architecture, and operations documentation | Markdown | Active but contains stale statements | Medium | Maintainers and users |

## Dependency direction

```text
browser
  -> apps/web route/controller
  -> apps/web bounded ClearSign client
  -> apps/api
  -> clear-msig-command-contract
  -> clear-msig-execution
       -> clear-msig-intent
       -> clear-wallet-client
       -> clear-wallet program types
       -> Solana RPC / Ika / destination RPC

clear-wallet program
  -> clear-msig-signing (canonical parse, render, payload, envelope)
  -> program-owned state and policy verification
  -> destination preimage builders

apps/cli
  -> clear-msig-execution (same lifecycle and execution library as backend)
```

`apps/settlement` is a separate service and dependency graph. It does not pass
through the multisig execution library and its custodial signers are therefore
a distinct privileged path.

## Boundary findings

1. The frontend contains both browser workflows and server-only Next.js API
   handlers. Repository separation requires explicit API/schema packages before
   moving either side.
2. `clear-msig-intent` describes executable transaction templates. The complete
   canonical approval schema, codec, commitment, and renderer now live in the
   no-std `clear-msig-signing` crate.
3. The frontend does not generate v4 authority commitments. The backend and
   onchain program consume the same Rust signing crate, and the browser signs
   the backend-prepared canonical review.
   The former 1,197-line browser v3 authority module was removed; browser code
   now owns only typed, untrusted v4 intent inputs and response-shape checks.
4. The execution crate remains broad, but instruction construction is now split
   by proposal, escrow, remote send, agent, governance, SOL, and lifecycle
   ownership. Ika network orchestration is separated from pure chain-preimage
   construction, and proposal command dispatch is separated from remote
   execution/broadcast helpers. `commands/proposal.rs` is still 2,513 lines and
   its action families require another controller split.
5. The frontend architecture gate enforces import and size constraints and now
   reports zero runtime modules at or above 1,000 lines. Landing, recovery,
   import, escrow, and secure-vault routes were decomposed into route,
   presentation, domain, and infrastructure-owned modules without changing UI
   behavior. The largest send and wallet routes remain approximately 920-986
   lines and are the next controller boundaries to reduce.

## Enforced repository shape

- Runnable products live under `apps/`: `web`, `api`, `cli`, `e2e`, and the
  independently versioned `settlement` service.
- Reusable Rust authority and execution code lives under `crates/`.
- The only deployable Solana program lives under `programs/clear-wallet/`.
- The only checked generated Solana instruction client lives under
  `programs/clear-wallet/client/src/generated/`; CI compares it byte-for-byte
  with a fresh `quasar build` output.
- `scripts/check-repository-boundaries.sh` rejects legacy top-level apps,
  browser-to-service source imports, trusted-code imports from the web app, and
  duplicate generated program clients.
- The Vercel project root is `apps/web`; legacy top-level application aliases
  are rejected by the repository boundary gate.

This layout makes private extraction mechanically possible. It does not make
the current GitHub monorepo private, erase public history, or turn source
privacy into an authorization control.
