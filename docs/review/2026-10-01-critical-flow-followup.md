# Critical flow follow-up

Locally implemented after the first consolidated review; no source publication, deployment, wallet signing or financial calls.

## Batch execution evidence

- `useBatchSend` now consumes execution responses. `execution_submitted` requires a canonical nonzero Solana signature decoding to 64 bytes, the expected proposal, and `typed_sol_batch_send` response path. It does not claim chain confirmation/finality.
- Empty/malformed/mismatched/error responses produce `execution_unknown`, retain the existing request, show its full address/status link, and offer no blind retry. The transaction signature is visible for verified submission responses.
- Scoped exact ordered recipient/lamport payload recovery records the expected proposal before creation. Lost responses retain uncertain IDs across navigation/reload. A separate persistent execution-phase lock is written before execution and cannot be cleared by separate-request acknowledgement. The endpoint is called with `retry:false`.

## React lifecycle

`useRequestIdentity` captures an operation token after mount rather than a render-time lifecycle epoch. Cleanup invalidates old tokens, each identity transition invalidates old render scopes, and StrictMode effect replay still permits fresh captures. `useSendRecovery` likewise invalidates old attempts on unmount. Accepted/uncertain work remains recorded in its original scope.

An independent actual mounted-React harness imported the production hooks unchanged: deferred wallet-boundary completion after unmount or A→B→A produced zero subsequent submit/execute calls; StrictMode fresh operations worked; accepted/unknown metadata survived remount. These are synthetic provider boundaries, not live wallet tests. Evidence: `/workspace/scratch/clearsig-hook-lifecycle/results.json` and its reproducible entry/build files.

## Legacy chain setup compatibility

All six install-intent producers (SOL, EVM, ERC20, BTC, ZEC and new wallet) use a common preflight before encryption/prepare/sign/submit. It verifies pinned genesis, finalized program-owned wallet/AddIntent accounts, canonical wallet/intent PDAs and bumps, approved authority, threshold one and the proposing signer's membership among approvers. The source program automatically approves that supported path.

Approval-dependent setup is explicitly unavailable because a canonical install-intent approval protocol is not implemented. Manual legacy approval is not re-enabled. Existing configured chains remain usable. If deployed behavior still needs an explicit legacy signature, the saved request is retained and shown; the UI does not generate a blind replacement.

New-wallet multi-approval setup is rejected before wallet creation. Required network identity is also checked before wallet creation. Afterwards the wallet is looked up by name and its actual creator/PDA is verified; the backend payer is not assumed to equal the connected member. Regression includes payer≠member. BTC's inherited roster comes from the freshly verified authority.

## Checks

- Architecture passes with BTC route extracted to a cohesive setup infrastructure function (route 899 lines); no limits relaxed.
- Typecheck passes; targeted ESLint passes after its one cleanup-ref warning was fixed.
- Six focused suites / 86 tests pass, including the actual BTC setup producer asserting zero encryption/prepare/sign/submit for unsupported authority; shared setup producer checks cover every route, ownership/genesis/identity faults and lost responses.
- Batch tests exercise empty/malformed/wrong-context execution responses, typed persistent locks and preserved request IDs. Actual React lifecycle browser evidence is separate from these unit counts.

Residual deployment/provider/authentication, canonical install-intent migration, strict external execution/protection, signed-limit integration and bundle-budget gates remain as documented in the consolidated report.

Final narrow follow-up: all six legacy setup producers now capture the actual mounted request identity before asynchronous work, guard immediately before the signing popup, and check again before submission and execution. The shared setup recovery wrapper preserves an accepted proposal ID before rejecting a changed lifecycle. New wallet creation also checks identity before its sponsored creation write. Newly created wallets wait read-only up to30seconds for both finalized authority accounts; missing finalization retains an explicit existing-wallet recovery message, never downgrades commitment. Legacy setup focused tests now20pass, including missing-then-valid finalized snapshot and delayed signing invalidation with zero submit. These use mocked RPC/provider boundaries. Final architecture gate passes (BTC902lines, ZEC908); no limits changed.
