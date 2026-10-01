# Execution consumer follow-up — 1 October 2026

Base `0c95c5c766e75f0e2482030486c42c5555029c90` remains preserved. The independent re-audit identified valid additional completion claims beyond the earlier inbox/batch fixes. This follow-up addresses the same consumer class across active routes; it does not claim that local tests establish live integration or deployment readiness.

The separate test-only commit `39bb76f1` reproduces and repairs the user-supplied Vercel failure. See `vercel-test-environment-2026-10-01.md`: exact older code reproduces 10/1,026 failures, and its corrected tests pass1,033+14 scripts. Production configuration guards are unchanged.

## Changes and evidence boundary

| Consumer | Corrected behavior |
|---|---|
| Proposal timeline | Action-specific labels. An external/unknown action's Solana status never becomes “Money sent” or “Action complete.” Native SOL completion requires a compatible verified canonical review. |
| Approval/cancellation | Missing/malformed receipt stays unknown; valid receipt alone is submitted. Confirmation requires the correct actor bitmap in finalized owned context under unchanged authority. Saved actor/context/signature survives reload; status checks are read-only. |
| Six legacy setup producers | Require matching finalized canonical execution plus exact installed AddIntent bytes before readiness. Missing/wrong/unavailable/changed genesis blocks execution rather than being treated as ordinary finality lag. |
| Member/threshold/timelock governance | Exact reviewed replacement and finalized installed intent required. Removed five automatic execution sweeps and the unused legacy completion helper. Existing active requests remain explicit blockers with their IDs. |
| Policy and agent authorization/settlement records | Bind expected wallet/action, immutable canonical hashes/document and action-specific local identities. Only finalized matching records become executed. This establishes Solana records, never venue fills or external settlement. |
| Escrow | All eight executors retain deterministic request identity and immutable context; receipts are submission evidence. Finalized matching canonical action gates local execution status; external/private destinations remain unverified. |
| Recurring schedules and Pay now | All six executors preserve pending context and disable retries. Schedule changes require finalized canonical action. Pay now additionally requires exact finalized schedule identity and payment-counter advancement. |
| Native SOL send | Real operation lifetime and durable request recovery through prepare/sign/submit/execute. Exact decimal units replace float multiplication; unsupported precision/range fails before signing. Empty/mismatched execution response cannot produce completion. |
| External sends and history | Validate action/chain and signature/hash shape; keep request and known submission ID. Broadcast receipts and activity use submission/pending language. Submitted attempts do not emit an executed/failed webhook. |

Signed submit endpoints were already single-shot. Reviewed execution paths now also explicitly disable automatic HTTP retries. A valid transaction identifier never supplies finality by itself. No account, financial provider, wallet or external destination was exercised live.

## Conservative compatibility and remaining gaps

- Canonical multi-approver install-intent setup still needs protocol support; no legacy signer bypass was added.
- Generic v4 execution remains blocked. Specialized inbox recovery exists only for documented native/governance/legacy capabilities; unsupported kinds require their compatible executor.
- Old agent/recurring records lacking original canonical commitments require explicit canonical review, not automatic replay. Same-device binding metadata is a recovery hint checked against trusted chain evidence, never independent authority.
- Uncertain attempts stay saved for authoritative reconciliation. A failed response does not establish that no transaction occurred; no blanket automatic retry or “funds never left” claim remains in the reviewed attempt history.
- External venue execution remains gated. Strict native atomic protection, complete integration/reconciliation and pending allocation/timezone choices remain unresolved as documented in the prior completion map. Paystack/Korapay and quote-provider policy are unchanged; executable settlement quotes remain unavailable.
- Mainnet-equivalent production guards, original palette, dependency versions and build budgets are preserved. No Rust/SBF source change, publication, deployment or live financial operation occurred.

Final full-suite/compiler/budget measurements and exact commit/tree are in the portable handoff. The mounted React lifecycle harness uses actual production hooks with explicitly synthetic RPC/backend/signing boundaries. The final source needs independent re-audit; this report does not assert perfect security or a drop-in devnet release.

## Final local validation

- Full production-environment `npm run verify`: **221 suites /1,719 tests +14 script tests pass**, including temporary local Redis integrations, architecture, metadata, intent registry, lint and typecheck.
- Actual Chromium React DOM/StrictMode lifecycle harness: **12/12 pass**, with seven matching production-source checksums. Deferred-sign unmount/ABA blocks writes; fresh operations work; request IDs and known submission ID survive remount.
- Production compilation: **pass, 50 pages**. The standard complete build remains **blocked** by unchanged bundle budgets: largest chunk535.7/506 kB gzip; authenticated route1,020.6/971; external runtime1,149.5/1,100; legacy Turnkey1,010.4/954. No limit or command override was made.
- Exact native SOL orchestration:15 cases, including the one-lamport floating-point mismatch regression. Actual receipt components render submitted/pending states; no external finality was fabricated.
- Root Rust/SBF and dependency manifests unchanged. Historical Rust/security results remain historical; no new live auth, wallet, payments, venue, or hosted configuration verification is claimed.
