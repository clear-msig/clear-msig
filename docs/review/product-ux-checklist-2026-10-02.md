# ClearSig product UX assessment — 2 October 2026

Baseline assessed: `834bc7990a7f0c1004314476c89d13e7d0727856`.
“Verified” below means inspected source and/or the stated local rendered evidence,
not a live authenticated product qualification. CI and deployment succeeded;
the executor proxy blocked the custom domain. No time-to-value study was conducted.

| Criterion | Baseline assessment and evidence | Bounded improvement / remaining limit |
| --- | --- | --- |
| Time to value | **Partial.** `features/landing/routes/LandingPage.tsx` offers a readable 5 SOL approval example before login; local 1440/390/320 captures confirm it is legible. | Real financial first value still needs auth, wallet setup and approvals. Do not claim “seconds” without a timed comprehension study. |
| Minimal onboarding, first win, thumb reach | **Partial.** Product choice preserves intent into connect; main actions use large touch targets. `components/onboarding/WalletTourModal.tsx` auto-opens after 250 ms on a fresh device, interrupting the first wallet visit. | Make the guide opt-in below primary wallet actions. Keep real permission setup; a sample review must remain explicitly illustrative. Mobile first-visit and physical-device usability are not established by source alone. |
| Motion, feedback, safe progress | **Verified local subset / partial overall.** Landing reveal/logo controls pass reduced-motion, no-JS, keyboard and repeat-scroll checks. Saved send/vote recovery distinguishes submission from confirmation. | Do not turn progress animations or returned transaction IDs into success claims. Broad authenticated error-state coverage remains incomplete. |
| Repeat-user efficiency | **Implemented / partial evidence.** `components/layout/CommandPaletteLoader.tsx` handles Cmd/Ctrl-K; `CommandPalette.tsx` searches wallets/requests with keyboard navigation. `features/send/routes/BatchSendPage.tsx` imports CSV and creates a reviewed batch. | Not a universal shortcut system or unreviewed bulk approval. The palette and batching have not been qualified with real authenticated users here. |
| Density, filters, saved views | **Partial.** `app/app/activity/page.tsx` has status/network/wallet filters, search, CSV export and device-local filter persistence. | A remembered filter is not named/shared saved views; search is not persisted with those filters. Source and representative fixtures do not prove large-dataset readability/performance. |
| Permissions, signer audit and waiting state | **Partial.** `app/app/proposals/[proposal]/page.tsx` shows role, full signer address and Approved/Waiting/Voted-to-cancel from bitmaps. Canonical readers bind current finalized authority; recovery retains uncertain attempts. | A signer bitmap is not a per-signer historical timestamp/signature audit trail. Add evidence-backed transaction/time links only where actually available. |
| Workflow integration | **Partial.** CSV import/export, request links and browser-session webhook configuration exist. `features/settings/ui/NotificationSettingsControls.tsx` explicitly says hooks fire only while the app is loaded. Paystack/Korapay adapters remain. | Do not advertise reliable background notifications or native QuickBooks/Xero/Safe/Squads integrations merely because names appear in configuration. Financial settlement still needs executable quotes/auth and provider evidence. |
| Human-readable intent first | **Partial, concrete caller defect.** Shared preview preserves supplied fields, but `features/send/ui/solana/solanaSendPreview.ts` and `SolanaRecipientFields.tsx` shortened destinations. `prepareSolanaSendProposal.ts` proceeded from backend preparation straight to signing. | Show full destination and introduce explicit review of the exact prepared message before the next prompt; reject stale form/account revisions and expired reviews. This is not independent decoding. |
| Independently verifiable signing binding | **Missing as a qualified user workflow.** `lib/clearsign/readProposalReview.ts`, `proposalReview.ts`, shared Rust codecs and program tests provide real binding checks. | Same-app text/hash display is not an independent verifier. A separately usable verifier needs canonical input/actual signing-byte comparison, trusted deployment identities, provenance and separate validation. Ledger transport code does not prove physical-device display or hash support. |
| Risk-weighted warnings | **Partial.** `solanaSendPreview.ts` prioritizes cap/velocity warnings, then unknown-address warning; `batchRisk.ts` supplies specific cap/count explanations. Policy review exposes unlimited/denied scope. | Local budget/indicative-price hints are not universal on-chain enforcement. Multiple simultaneous warnings can currently be suppressed by the first-return priority. No comprehensive transaction simulation/anomaly classifier is established. |
| Proportional confirmation friction | **Partial.** Review details and signer narration exist; recovery prevents blind retries. | Remove automatic tour friction, not informed approval. Exact-message review adds justified friction before SOL signing. Do not auto-approve low-risk actions or encourage approving unreadable prompts. |
| Explicit trust/control model | **Partial with misleading copy to fix.** `app/privacy/page.tsx` claimed private membership and active encrypted checks while also describing future FHE. `README.md` discloses devnet-only/single mock Ika signer. | Correct privacy/security pages and signer narration: distinguish browser hints, backend preparation, supported on-chain enforcement, durable recovery storage, upgrade/provider dependencies, mock signing and unavailable production FHE. |

## Suitable now

1. Remove automatic tour interruption; retain an accessible optional guide.
2. Fix full-address SOL callers and render the exact prepared message before signing,
   with one-use confirmation and stale/expired/unmounted rejection tests.
3. Correct public and in-app trust claims and remove “approve both prompts”/opaque
   hex reassurance from shared signer narration.
4. Verify these actual components at desktop/390/320 widths, keyboard and reduced
   motion, using explicit synthetic signer boundaries; rerun full production checks.

## Recommendations, not implied completed features

- Independently distributed verification and qualified physical signer displays.
- Evidence-backed per-signer historical audit details and authenticated usability
  measurements, including time to understand the first sample and time to first
  completed supported action.
- Named/shared views or reliable background integrations only after demonstrated
  workflow need, authorization and backend support.
- Proven native atomic protection and policy/allocation decisions before external
  agent execution; no compensation-based weakening, new custody rights or live setup.

No palette change, finance gamification, urgency, social-pressure trading or new
provider/account permissions are part of this continuation.

## Follow-up applied

- The wallet guide is explicitly opened by the user, remains keyboard accessible,
  restores focus on close and leaves wallet actions/pending approvals unobstructed.
- SOL compose preview details retain complete contact/SNS/raw destinations, exact entered
  amounts and nine-decimal fee reserves. The previous four-decimal preview presentation
  could make a one-lamport transfer or small reserve appear to be zero.
- The SOL send flow now renders the descriptor-verified, exact prepared message
  before the first signature and before any separate approval signature. Each
  review is consumed once. Form/account/network/policy revisions, account ABA,
  unmount, cancellation and expiry cannot reuse an accepted review. Cancelling
  an approval retains the already-created proposal and does not execute it.
- The readable message remains server-prepared. This change does not implement
  an independent decoder/verifier, qualify hardware displays or change authority.
- Shared signer narration no longer normalizes opaque bytes or instructs approving
  both prompts. Public privacy/security and in-app architecture now state current
  devnet, mock signer, unimplemented production FHE and trust dependencies.

Validation: 226 suites / 1,756 tests and 27 script tests passed, including isolated
Redis integrations, lint, typecheck, metadata, intent and architecture checks.
The final environment restart interrupted production compilation after those
checks; resumed production compilation and unchanged scoped main-devnet bundle
gates passed with exit 0. The standard authenticated maximum remains 998.8/999
KiB gzip, external runtime 1123.8/1124 and legacy Turnkey 990.7/991. Hosted
commit checks are recorded in the final publication report.

Actual production guide, recipient, review and hook components passed Chromium
at 1440, 390 and 320 pixels: opt-in initial state, keyboard focus/trapping/return,
repeat open/completion, full destination wrapping, cancel, amount edits, account
ABA, unmount and repeated confirmation. Public privacy/security changes were
rendered at 390 pixels. Browser dependencies were explicitly disconnected and
the signer was a synthetic counter, with external requests blocked. This is not
live authenticated route, hardware or financial integration coverage. No measured
time-to-value improvement is claimed. Rust/SBF code and the approved palette are
unchanged.


## Policy freshness follow-up

The independent review found a stale-review UX gap, not a demonstrated on-chain
permission bypass. The SOL caller now captures local policy authoring data and
reads the active on-chain WalletPolicy commitment before preparation. Prepared
policy bytes must match a nonempty captured active commitment. It rereads policy
before displaying the document, at review completion, immediately before the
signer handoff, after the signature, and before submission/execution. Failed reads
stop the flow. A local policy edit closes a pending review and invalidates its
one-use session, including cross-tab events and change-then-restore events.

Local snapshots cover advanced rules, budget, recipient allowlist, time window
and member allowances. Invalidation is deliberately conservative across wallets
on this device. Chain reads are snapshots: a change after the last RPC read can
still race the client; program checks remain the execution authority. This is not
a continuous finalized-state subscription or independent verification.

Regression coverage includes active-policy changes during proposal and approval
reviews, a change between accepted review and signer handoff, changed policy
while a signature is pending, RPC failure, preparation/active-commitment mismatch,
local edits without an event, cross-tab ABA, and retention of the existing request.
Chromium at 1440/390/320 verifies actual review-hook cancellation and new-review
recovery, including a policy event in the same event-loop turn as confirmation.
The browser signer is a counter; RPC/wallet orchestration tests use synthetic
providers, not live signing.

Precision boundary: the exact prepared-message review and compose preview rows
retain entered precision. The compose input, Use max, compose headline and receipt
still use four-decimal input/formatting. End-to-end nine-decimal UX is **not**
claimed. A separate bounded cleanup can use nine-decimal input and bigint-based
Max/display formatting while keeping the existing fee reserve; it needs actual
compose/receipt caller regressions. No financial semantics or fee reserve was
changed by this policy repair. The public security page now correctly describes
the full-address SOL review.

Final local validation: 227 suites / 1,769 tests and 27 script tests passed (the
six isolated Redis cases were run explicitly with the Redis binary after the
otherwise passing final verification run). Lint, typecheck, intent, metadata and
architecture checks, production compile and unchanged bundle gates passed.
Runtime maxima remain 998.8/999 KiB standard, 1123.8/1124 external and
990.7/991 legacy Turnkey. Rust/SBF source and colors are unchanged.

The subsequent signing-family, exact-precision, mobile and signer-evidence work
is recorded in [the 3 October completion review](signing-flow-completion-2026-10-03.md).
Earlier gaps and test counts above describe their stated historical checkpoint.
