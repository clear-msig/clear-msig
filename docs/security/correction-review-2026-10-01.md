# Independent-review corrections — 1 October 2026

Correction base: `c6179004657d7454bb190478393bd5caf9ae48f7`. That checkpoint's
passing tests did not cover all recovery consumers and React operation lifetimes.
The independent review found real gaps; the prior J08 disposition was too broad.
This report supersedes that disposition for inbox/Activity recovery and batch
execution. No publishing, deployment, provider login, wallet signature or
financial operation was performed.

## Corrected pathways

1. **Execution evidence and recovery:** the proposal inbox previously accepted an
   empty success-shaped execute response and toasted Done/Sent. Batch execution
   discarded the response. Both now validate action-specific response shape,
   canonical transaction-signature representation and available request/action
   identity. A transaction ID is submission evidence, not chain finality. Pending
   and unknown outcomes use neutral copy; completion requires an independently
   verified finalized, program-owned proposal state. Solana status never proves
   destination-chain/provider/trade completion.
2. **Interrupted execution:** automatic HTTP retries are disabled for these
   reviewed execution paths. Scoped creation and execution records retain the
   original proposal and known public transaction ID. Reopening through Activity
   or the request link offers a read-only status check. Separate-request
   acknowledgement cannot clear an execution lock. Unknown/malformed responses
   and delayed errors do not make a request safely resubmittable. An ambiguous
   or definitively failed attempt without proven completion still needs exact
   transaction reconciliation; this slice does not infer permission to retry.
3. **Operation lifetime:** request identities and send recovery capture separate
   operation generations. Every identity transition and unmount invalidates old
   attempts, including A→B→A. Real React DOM/StrictMode tests cover deferred
   signatures and verify that fresh mounted operations still work. Already
   submitted/unknown request identities survive unmount and remount.
4. **Legacy setup producers:** Bitcoin, Zcash, SOL, ETH, ERC20 and new-wallet
   bootstrap still use legacy install-intent proposals. A separate legacy
   approval is intentionally blocked by the canonical signer. The producer now
   preflights supported automatic approval before encryption/prepare/sign/submit:
   pinned genesis, finalized owner/PDA/bump/name, approved AddIntent authority,
   threshold one and proposer also an approver. Unsupported separate-approval
   setup is refused before creating an unusable request. New-wallet lookup must
   resolve the actual backend-payer-created canonical wallet rather than derive
   it from the connected member. Existing configured wallets and pending request
   identities are preserved. New-wallet setup waits for finalized authority for
   up to 30 seconds; timeout retains the created wallet and directs recovery
   without creating another wallet. No legacy-approval guard is relaxed.

## Deliberately limited recovery capabilities

The old generic typed executor only changes status; its Rust guard rejects v4
requests. Sending every v4 inbox request there was not a functioning recovery
path. Supported inbox dispatch now consists of:

- typed governance kinds 3/4/5 through the existing governance executor;
- native SOL kind 1 through the existing SOL executor, with exact amount and
  full destination reconstructed from the verified full-profile signed document,
  fresh review fingerprint, explicit chain/asset checks and exact safe numeric
  bounds;
- existing legacy local/remote execution contracts, with their response evidence
  checked and remote finality never inferred from Solana authorization.

Other typed actions need a compatible action-specific recovery executor. The
inbox explicitly marks that capability unavailable before execution; review and
cancellation remain. Existing specialized product executors are retained, but
this report does not claim that their new-request forms resume an old proposal.
Multi-approver install-intent approval requires a canonical protocol/renderer/
program integration; it is not a deploy-time flag. The safe preflight gate is a
compatibility boundary, not completion of that missing capability.

## Validation and rollout boundary

Consolidated verification passes 209 suites / 1,518 tests plus 14 script tests.
The actual React DOM/StrictMode harness passes all 12 lifecycle cases against
matching source checksums. Production compilation generates all 50 pages.
The unchanged budget gate fails: largest chunk 535.7/506 kB gzip; worst
authenticated route 1,013.2/971; external runtime 1,142.1/1,100; legacy Turnkey
1,003.0/954. The exact correction tree and logs are in the portable handoff.
A compiler-only client-directive placement error discovered during consolidation
was corrected before the final successful build.
The handoff includes real React lifecycle harness source/results, targeted
regressions, full verification/production compile logs and unchanged bundle-gate
measurements. Provider/RPC/signing boundaries remain synthetic. Root Rust/SBF
sources remain unchanged since the frozen `7f804704` transfer and are not rerun
in this executor.

A protected devnet rollout still needs the independent correction review, the
normal build gate, matching hosted web/API configuration and verified program
compatibility. The staged readiness assessment in the handoff separates those
requirements from intentionally unavailable external trading/ramp features.
No live deployment readiness is inferred from local fixtures or a compiler pass.
