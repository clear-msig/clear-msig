# Canonical proposal approval review — 1 October 2026

## Implemented production path

Proposal detail now reads the stored v4 full-profile ClearSign document from
finalized program-owned proposal, wallet and intent accounts. It verifies the
configured Solana genesis, program ownership, PDA seeds/bumps, approved intent,
proposer membership, quorum and exact raw action/nonce commitment bytes. It
recomputes the v4 envelope using the checked-in Rust hashing format; the existing
Rust transfer golden vector is a regression fixture.

The complete canonical action document is visible, together with full wallet
and request accounts, exact expiry, required threshold/member count, and an
explicit unavailable-fee notice. No amount, address, fee, permission or price is
invented. Original colors remain intact. Approval receives the displayed review
fingerprint, reads fresh authority, binds every prepared descriptor identity
and the exact signed document, and rechecks before signing and before submission.
A changed request, rejected signature or repeated concurrent click cannot submit
through this workflow. The individual-review path replaces the bulk-approve CTA;
central signing guards also reject unreviewed typed approvals and legacy votes.
Cancellation paths are retained.

This verifies **stored canonical rendered bytes**, not a fresh decode of original
canonical intent bytes: the latter are not stored in the existing proposal
account. Trust rests on the pinned program's creation/rendering/envelope checks
and the configured RPC. It is not a light client. No wire/account layout changed.

## Exact action coverage

| Kind | Full-profile document review |
|---|---|
| 1 / 2 | Transfer / every batch payment |
| 3 / 4 / 5 | Member authority / removal / threshold changes, including resulting proposers, approvers and timelock |
| 7 / 8 | Escrow milestone release / returns |
| 9 | Agent trade authorization document; external execution remains separately gated |
| 12 / 13 / 14 | Agent session / risk / settlement documents; review does not establish venue execution or evidence by itself |
| 15 | Recurring schedule create/revoke |
| 6 / 16 | **Blocked:** protection-policy documents expose a commitment but not decoded underlying rules |
| 10 / 11 / unknown | **Blocked:** no supported canonical action review/execution path |
| Legacy / compact / incomplete / mismatched | **Blocked:** full-profile v4 review required |

Tests cover all accepted document shapes and rejection of missing required fields;
only transfer uses an existing cross-language golden document. They do not imply
all action kinds were executed against a deployed program. There is no current
mainnet network enum in this v4 renderer; unsupported networks are not relabelled
or allowed through weaker checks.

`NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH` must be set to the independently
verified deployment identity. It has no invented default. This is a deliberate
compatibility gate: unconfigured deployments and older/compact requests cannot
approve through this path. A future protection-policy decoder/full review and
legacy migration are code work, not something credentials resolve. Execution and
cancellation are not newly authorized by this review panel.

## Verification

- Full verification: 184 Vitest suites / 1,214 tests and 14 script tests; includes
  actual isolated Redis integrations. Intent registry, metadata, architecture,
  ESLint and TypeScript checks pass.
- New coverage: 55 document/envelope/binding tests, 13 synthetic RPC/account tests,
  9 production-hook tests with mocked RPC/backend/wallet boundaries, and 3 rendered
  component cases. Existing baseline: 180 suites / 1,134 tests.
- Production build: 50 pages. Bundle gate fails: 535.7/506 kB largest chunk;
  1010.5/971 authenticated peak; 1139.4/1100 external runtime; 1000.3/954
  legacy Turnkey. Proposal route: 983.2/971 kB. Logs are included in the handoff.
- Actual Chromium component checks: 320/390/1440 dark and 390 light, reduced
  motion, full visible document, no horizontal overflow, blocked state hiding
  stale details, keyboard refresh and disabled loading state. Captured account
  context is synthetic; no real login, RPC, wallet signature or transaction.
- Root Rust/SBF code remains unchanged after original 7f804704. Not rerun here;
  toolchain unavailable. No new program deployment is required for the existing
  v4 full-profile path, but deployed program compatibility must be verified.

## Finite remaining gates

1. **Two user policy choices:** restricted single active execution per wallet with
   full-close settlement versus concurrent/partial allocation; explicit daily
   reset timezone. Risk amounts, allowed markets, leverage and take-profit
   choice come from saved user controls, with no assistant-selected allowances.
   Strict stop protection, gross realized PnL/net aggregation and entry-fill
   cooldown semantics remain unchanged.
2. **Code, not configuration:** versioned venue-limit canonical signing/rendering
   and program-recognized binding/resolver; authenticated v2 route composition;
   opening/child-order reconciliation and exact opening-to-closing allocation
   after the execution-mode decision; separate emergency-close/rotation authority.
   Existing implemented pinned readers, immutable account binding, durable
   reservation/handoff, restart recovery and trusted closing-evidence consumption
   remain intact. The strict required-field limits manifest already exists.
3. **External capability:** native atomic protected entry has not been proven.
   Batch/grouping semantics alone do not satisfy it. No compensation model or
   unprotected executor was enabled. Credentials cannot solve this gate.
4. **Configuration/live verification:** trusted pinned RPC/program, durable Redis
   persistence/no eviction, reviewed dedicated venue assignments; real auth/MFA,
   embedded/external wallets and devices; settlement executable quote/auth and
   trusted deposit/provider evidence. Paystack/Korapay remain. No quote-provider
   replacement or account provisioning occurred.
5. **Frontend release gates:** secured Dynamic SDK bundle limits still fail;
   no threshold changes, unsafe deep imports or vulnerable downgrades. Headless
   migration is separate substantial scope. Additional per-action live browser
   flows and policy-detail decoding remain; app-wide synthetic inventory is not
   a claim all 85 routes or integrations passed live testing.

All source changes remain local for review. No push, merge, preview deployment,
production change, credential provisioning or live financial operation.
