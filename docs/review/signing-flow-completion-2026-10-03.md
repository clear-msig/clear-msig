# Signing and product-flow review — 3 October 2026

This continuation preserves the deployed palette, existing financial reserves,
provider choices and strict execution gates. Browser evidence below uses actual
components with explicitly synthetic/disconnected dependencies and blocked
external requests. It is not live authenticated, hardware-wallet or financial
integration qualification.

## Six-item status

| Item | Implementation and local evidence | Remaining boundary |
|---|---|---|
| Signing-family inventory | Audited SOL, native EVM, ERC20, BTC, Zcash, batch, inbox approve/cancel, membership/threshold/timelock/policy, wallet/intent setup, recurring/escrow and agent policy/session/settlement/local permissions. Shared signing now requires exact prepared-document review; decoded legacy setup includes complete permission definitions and exact bytes. Unsupported opaque legacy approval remains blocked. A shared message-signing handoff lock, expiry, route/account/secondary-signer/form/policy revisions and caller cancellation guards prevent stale or overlapping handoffs. Typed review rereads owned PDA/governance/policy/proposal state and vote count. | Supplementary RPC snapshots use confirmed state and are not independent finalized/genesis verification; canonical approval readers and program authorization remain authoritative. Independent device display and live providers are unqualified. |
| Exact precision | SOL input, max, headlines and receipts retain nine decimals; native EVM max retains eighteen; ERC20 presentation uses token decimals. SOL balance validation uses exact raw units. BTC keeps satoshis and Zcash keeps its existing raw-unit path. Full destinations/contracts remain visible. Invalid exponent/separator text is rejected instead of stripped into another amount. | Existing reserves/economics unchanged. Rendered SOL/EVM tests are synthetic, not submitted funds. |
| Simultaneous risks | SOL and batch surface all applicable chain-cap, wallet-cap and velocity warnings; raw-address warning remains alongside them. Enforcement still blocks denied transactions. | This combines existing known findings; it does not claim exhaustive fraud detection or permit approval to override hard policy. |
| Mobile journeys | Actual tour, review and precision components pass Chromium at 320/390/1440: opt-in tour, focus trap/return, Escape, repeat visits, cancel, stale preparation, form/policy changes, account ABA/unmount, secondary signer change, disconnect/reconnect, rejection/retry, duplicate confirmation, back/forward and caller cancellation. Recurring/escrow controllers retain recovery IDs while blocking stale continuations. | Real onboarding/account creation, provider redirect, physical hardware, live submission and provider outages require configured integration tests. Treasury lifecycle coverage is controller regression, not mounted authenticated browser coverage. |
| Signer evidence | Proposal history offers a bounded manual finalized-transaction lookup. Full transaction IDs, slot and nullable inclusion block time accompany recognized votes. Detached v4 signatures are verified before attributing the current indexed signer; fee payer is never substituted. Unknown/pruned/legacy/inner instructions or unverifiable historical roster/threshold remain explicitly unavailable. | Inclusion time is not personal signing time. Scan is bounded to sixteen transactions; not a complete archive, and automatic creation approval is not fabricated as a separate vote. No live RPC history was fetched. |
| First experience | Measure the local production landing promise visibility and illustrative approval response with fresh browser contexts; attach exact measurement conditions/results below. | Browser timing does not measure comprehension. Human time-to-understanding and time to first real supported transaction remain unmeasured. |

## Signing entry-point inventory

The reviewed message-signing families route through `useSignWithWallet`;
injected/Dynamic message transport remains below that boundary. Secure vault
creation/import, enrollment, threshold changes and sweeps use a separate
`wallet.signTransaction` path (including `NewRecoveryPage` and the Dynamic
runtime adapter). These transaction-signing lifecycle paths were omitted from the initial
continuation. The subsequent `secure-signing-completion-2026-10-03.md` records
their separate captured-operation boundary, exact transaction review/signature
verification and durable interrupted-submission recovery. Message-signing
coverage alone must not be used as evidence for these transaction paths. Source inventory includes the send
routes and setup helpers; `useBatchSend`, `useBatchApprove`,
`useProposalWorkflow`, `completeTypedGovernance`, member/threshold/timelock and
persistent-policy hooks; wallet creation/intent setup; treasury controllers;
agent typed policy/session/approval/settlement hooks and two local-permission
surfaces (start controller and session creation). SOL retains its dedicated
exact-document review rather than displaying a duplicate modal.

Changing selected agent/venue invalidates a local permission review. Per-operation
cancellation is checked during the shared modal and before/after signing; a late
wallet signature cannot restore a cancelled request. RPC checks can still race
subsequent chain changes, so they supplement program checks rather than replace
them. Loading/verifier errors fail closed before submission.

## Validation

The consolidated validation passes 237 suites / 1,841 tests and 27 script tests,
including isolated Redis integrations, intent/metadata/architecture checks,
ESLint and TypeScript. A newly added batch regression proves cancellation inside
a pending signing review prevents submission. Additional browser logs confirm
all three viewport sizes described above. Production/bundle results and timing
measurements are recorded after compilation completes.

Root Rust/SBF implementation and dependency versions are unchanged in this
continuation. No palette or bundle-limit changes, removed provider, SDK private
import or downgraded cryptography is used. Signature/message verification loads
on demand but is mandatory before signed payloads can be submitted. Device
error identity is preserved across the adapter/error module split and tested.
Debug-only reports and panels load only when requested; the complete public-suffix
parser is split using [Webpack cache groups](https://webpack.js.org/plugins/split-chunks-plugin/),
with no data or provider removal. Runtime bundle totals still include that dependency.

## Human study still required

A follow-up participant task can ask a first-time visitor, without instruction,
to identify the illustrative action, destination, required/current approvals,
policy result and devnet/test-funds status, then find how to open a preview.
Record correctness, uncertainty and elapsed time; do not equate a quick click
with understanding. No participants or fabricated comprehension measurements
are claimed here.

## Final bundle result

The full production build exits 0 under the unchanged
`main-devnet-2026-10-01-v1` ratchet: authenticated route maximum **986.7/999 KiB**,
external-wallet runtime **1122.6/1124 KiB**, legacy Turnkey **978.6/991 KiB**.
The largest shared chunk measures **479.2/518 KiB gzip**. These are the existing
scoped ratchet gates, not attainment of the longer-term 250/150 KiB targets.

The `public-suffix` dependency is present in all four immediate wallet-runtime
manifests (Connect, external, WaaS and legacy Turnkey), so its bytes remain
included in the runtime totals. No required code is hidden from the measurement.
Repository governance/boundary/signing architecture and staged-secret checks
also pass. Pure module extraction preserves Ledger error identity; the real
adapter export is covered by regression tests.

## Measured local first experience

A separate production compilation of the same source used explicit test-only
public configuration placeholders (`backend.invalid`, no real accounts). The
browser blocked all external requests. Three fresh Chromium contexts per viewport,
reduced motion, warm local server and no network/CPU throttling produced:

| Viewport | Median navigation → headline visible | Median navigation → demo visible after scripted scroll | Median click → updated demo |
|---|---:|---:|---:|
| 390 × 844 | 377 ms | 449 ms | 54 ms |
| 1440 × 900 | 432 ms | 527 ms | 57 ms |

All six samples showed no horizontal document overflow. These locator-observed
measurements include browser automation overhead. They are technical local
observations, not physical-phone, deployed-network, comprehension, authenticated
first-value or before/after improvement claims. The initial unconfigured local
production run correctly showed a configuration error and was excluded from
landing measurements. [Raw samples and conditions](first-experience-2026-10-03.json)
are preserved. Human understanding and real provider/device journeys remain
explicitly untested.
