# Secure transaction-signing follow-up — 3 October 2026

This completes the locally implementable lifecycle boundary omitted from the
message-signing inventory. It retains supported operations, colors, provider
restrictions and program behavior. No live wallet, passkey, Ika, payment or
financial transaction was exercised.

## Caller inventory and implementation

| Direct caller | Guarded operations |
|---|---|
| `features/secure/routes/NewRecoveryPage.tsx` | Solo and multi-member vault creation, including delayed DKG/passkey preparation |
| `features/secure/routes/ImportKeyPage.tsx` | Imported-key creation and atomic funding; existing key wiping retained |
| `app/app/secure/[recovery]/enroll/page.tsx` | Passkey registration then enrollment; solo-only restriction retained |
| `features/secure/routes/RecoveryThresholdPage.tsx` | Staging/proposal/approval/execution and additional approvals |
| `features/secure/routes/RecoverySweepPage.tsx` | Proposal/approval/execution, additional approvals, and final Ika-signed broadcast |

Every current direct route passes a captured signer and connection through
`useSecureOperation`. Before provider handoff and each submission it checks the
captured account/session/network, route, mount lifetime and form scope. Returning
to the same account or form value does not revive the old operation. Delayed
creation after DKG is covered by a real action-layer regression. Additional
approvals can run while the parent awaits them, while the shared provider lock
still prevents overlapping wallet/message requests, including after timeout.

Each wallet handoff shows the actual transaction's full fee payer, blockhash,
network genesis, instruction programs/account privileges/data, relevant decoded
transfer amounts/destinations and protection fields, plus exact message bytes.
The recent blockhash must still be valid before handoff and broadcast.
Returned message bytes must match the reviewed bytes. All required Ed25519
signatures are verified, including local partial signatures. The final
network-signed sweep has its own explicit exact-byte review before broadcast.
Lookup-table transactions are unsupported by this review; existing builders do
not use them. This app review is not independent device-display verification or
an independent RPC/genesis trust anchor.

## Interrupted or uncertain submission

Before calling `sendRawTransaction`, the app durably saves the expected public
transaction ID, genesis, signer and action to browser storage. Transport errors
retain unknown status; a lost RPC response is never described as proof nothing
changed. Confirmation records the outcome even after navigation, then stops the
old workflow. Interrupted multi-step workflows keep their receipts. Reloading
shows the recovery notice and blocks starting over until outcomes are checked.
Only confirmed/finalized RPC outcomes resolve an unknown record. A missing status
stays unknown; the app does not silently replay or label it failed. After known
outcomes the user must explicitly acknowledge checking those transactions and
the existing vault before restarting. No automatic multi-step resume is claimed.

Creation now preserves pending DKG attestation material before submission in a
separate browser-storage entry. A lost confirmation can no longer discard that
material merely because the confirmed-vault save was not reached. It remains
subject to existing on-chain vault/dWallet verification and is not itself proof
of vault creation. Imported private keys retain their existing wipe behavior.
Recovery data is local to this browser, not a cross-device service. Clearing
browser storage removes local recovery data; unknown outcomes require chain
reconciliation, not a speculative retry.

## Verification

- Full frontend verification passes: **238 suites / 1,862 tests and 27 script
  tests**, plus intent/metadata/architecture, ESLint and TypeScript. Isolated
  Redis is explicitly enabled through the existing test-only binary settings.
  Log: `/workspace/scratch/secure-lifecycle-final-verify.log`.
- Production compilation passes. Existing main-devnet bundle gate passes:
  external-wallet runtime **1123.7/1124 KiB**, legacy Turnkey **979.6/991 KiB**.
  No dependency versions, budget limits or gate selection rules changed.
- Actual Chromium-rendered `useSecureOperation` fixture passes unmount,
  account/form ABA changes, navigation, repeated preparation, review cancellation,
  uncertain submission, reload persistence, blocked retry, status reconciliation
  and explicit acknowledgement. Signer/RPC are synthetic. Reproducible fixture:
  `apps/web/scripts/browser-regressions/secureLifecycle.cjs`; test-only esbuild,
  Playwright and Chromium are required (same runner setup as nestedSigning).
- The previous nested owner/prepared-signing dialog keyboard regression remains
  passing. Root Rust/SBF source and dependencies are unchanged; not rerun here.

## Remaining external gates

The existing dependency Security gate remains red; see
`dependency-investigation-2026-10-03.md`. Live configured provider, device,
passkey, RPC/Ika and authenticated account qualification remains outstanding.
Ledger and embedded-wallet Secure transaction limitations are preserved. Agent
venue policy/capability questions are unchanged. No dependency fork is introduced.
