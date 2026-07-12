# Independent review hardening ledger

This ledger uses three statuses: **complete**, **partial**, and **external**.
"Complete" means the claimed repository behavior is implemented and enforced;
it does not mean the production system is generally secure.

## 2026-07-12 checkpoint

| Review recommendation | Status | Evidence | Still open |
| --- | --- | --- | --- |
| Reusable Rust execution core | **Complete** | `clear-msig-command-contract` owns bounded domain requests. `clear-msig-execution` owns concrete preparation, handlers, cancellation, and infrastructure adapters. Both the backend worker and thin `clear-msig` binary call that library directly; CI rejects backend-to-CLI and CLI-to-infrastructure coupling. Solana and destination HTTP use injected ports. | This completes the shared-library topology recommendation, not production security. Ika client construction still needs a narrow injected port. |
| Complete Agent domain migration | **Partial** | Agent UI/controller boundaries and narrow infrastructure ports are enforced by `frontend/scripts/check-architecture.mjs`; direct legacy runtime imports from route/controller/UI fail CI. | Pure Agent domain implementations still physically live under `frontend/src/lib/agents` and are re-exported through the feature domain. |
| Reduce authenticated JavaScript | **Partial** | `npm run profile:bundles` attributes SDK modules by route; route/chunk budgets prevent regression. | No material shared-runtime reduction has landed. Current authenticated routes remain about 1 MB gzip under the project ratchet, dominated by Dynamic. |
| Adversarial end-to-end testing | **Partial** | SVM tests cover payload substitution, replay, wrong recipient/amount, stale policy/session, route/risk changes, limits, and duplicate execution. CLI tests cover interrupted signed MessageApproval recovery. | Compromised-relayer and interrupted cross-service tests against live destination testnets are not yet comprehensive property tests. |
| Formal trust boundaries | **Complete** | `docs/trust-boundaries.md` enumerates malicious frontend, backend, Redis, RPC, destination adapter, Ika, and program behavior plus recovery. | The mitigations named there still have their own open production blockers. |
| Internal threat/property review | **Partial** | Threat boundaries and deterministic adversarial regressions exist. | Property/fuzz coverage is not comprehensive and no independent audit has been completed. |
| External security audit | **External** | None claimed. | Commission after production Ika MPC and the typed async core stabilize. |

## Current measured qualifications

- Cold local optimized backend build: 28m51s on this machine.
- Optimized backend binary: 15,398,316 bytes.
- Current local SBF artifact: 615,184 bytes, SHA-256
  `3d22b71d939c001de34e2f86e6c50f85ee037a68b4b35d2bb3e697636d336321`.
- The old Docker build already compiled the same Solana/Ika graph for execution,
  so this is not a valid before/after build-time improvement claim.
- Backend timeouts cancel Solana, Ika, BTC, EVM, and Zcash network futures and
  allow a five-second drain. CPU-only transaction assembly remains synchronous;
  the default eight-worker semaphore bounds that work.
- Backend and thin-CLI clippy pass with `-D warnings --no-deps`. The reusable
  execution library still reports 18 pre-existing strict-clippy findings,
  chiefly oversized instruction-builder signatures; the program and wider
  dependency graph are also not globally warning-free.
- Raw-pointer account serializers are now explicit `unsafe fn` APIs with
  documented buffer requirements and explicit unsafe call sites.
- Agent Vault remains a pre-alpha governed-capital product direction. On-chain
  sessions are real; verified venue settlement, production MPC, and audited
  real-capital autonomy are not complete.
