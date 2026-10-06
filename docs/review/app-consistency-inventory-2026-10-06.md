# App consistency inventory — 6 October 2026

**Continuation:** [Expanded verification](expanded-app-verification-2026-10-06.md) supersedes the earlier representative-only coverage and isolated send retry below. Final coverage is 170/170 compiled route cases (85 entries, including 10 redirects), six setup variants, and the documented interaction/clearance checks. Six bounded source fixes retain existing palettes. Publication remains held.

Published baseline: `d751d94d1fd268084eaf164a1f2858a0622c8a25`. Further publication is held pending app-wide review.

85 page entry points, including aliases and redirects; these are not 85 verified independent screens.

## Current connected-component review

This section supersedes the historical signed-out gaps below. All **12 families**
have representative desktop/mobile app-owned renders; no entire family remains
unrendered. This is not a claim that every one of the 85 route entries or all state
permutations was exercised. The per-route implementation map is in
`app-route-implementation-map-2026-10-06.md`.

| Family (entry count) | Actual representative routes | Rendered / exercised states |
|---|---|---|
| Landing and selection (2) | `/`, `/choose` | Six widths; demo/reset, pause/resume, chooser/back; reduced motion and no-JS visibility |
| Public products (8) | `/personal`, `/agent`, `/secure` | Signed-out product pages at 390/1440; shared ProductSurfaceLanding |
| Public information (3) | `/security`, `/privacy`, `/changelog` | Signed-out content at 390/1440 |
| Authentication/onboarding (3) | `/connect`, `/app/wallet/new` | Signed-out app-owned handoff; connected create-wallet form; no creation |
| Wallet/shell (9) | `/app/wallet`, `/app/wallet/operations` | Funded synthetic wallet; empty/loading/error dashboard; switch dialog/Escape |
| Send/batch (9) | `/app/wallet/operations/send`, isolated review fixture | Actual SOL compose, address warning, real signing-review hook/document; focus/cancel/reopen/confirm at fixture boundary |
| Payments/exchange (3) | `/app/wallet/operations/buy`, `/sell` | Exact amount/full destination, checkout error; bank loading/empty/error/retry; invalid continuation disabled |
| Governance/treasury (14) | `/app/proposals/[proposal]`, `/app/wallet/operations/recurring`, `/members` | Synthetic canonical proposal, unavailable/loading review, recurring and members; real owner-dialog focus/Escape/cancel |
| Recovery (7) | `/app/secure`, `/app/secure/new` | Empty vault list; actual preset→confirmation; no create/device action |
| Agents (17) | `/app/wallet/operations/agents` | Real scoped dashboard/setup and unavailable external capability; Advanced disclosure; no execution |
| Settings/account (5) | `/app/settings`, `/app/account`, `/app/contacts` | Settings and theme, real app-lock form opening; contact add/cancel; no saved credentials |
| Activity/inbox (5) | `/app/activity`, `/app/notifications` | Synthetic history, empty history and inbox |

Connected fixtures replace only provider/read boundaries in an isolated source
copy. Real routes, shell, controllers and components render. Unmapped reads and
signing reject; browser external requests, API submissions, WebSockets and device
enrollment are blocked. Mock data is not evidence of chain authority. Current
public-route captures explicitly use signed-out fixture identity.

The first board pixel inspection caught an older public-product skeleton and an
invalid synthetic agent chain identity. Those are fixture/evidence failures, not
completed screen review. The current fixture uses a canonical-format synthetic
identity and waits for the real dashboard's Advanced control. Payment checkout
and bank-read errors have separate captures and explicit error assertions.

Local changes after `ca485437`: shared compact network picker, full receiving
address before checkout, honest bank error/empty/retry states, disabled payout
continuation without a returned bank, and existing high-contrast status tokens.
Original palette and signing/authorization guards remain. No delays or reveals
were added to critical transaction details.

The full local production build passed **244 suites / 1,922 tests**, **27 script
tests**, lint/type checks, compilation and unchanged bundle gates (external
1123.6/1124 kB; legacy Turnkey 979.6/991 kB). Fixture scripts are independently
validated. Rust/SBF source was not changed or unnecessarily rerun.

### Remaining coverage boundaries

App-owned routes not individually rendered are explicitly listed as source-only
in the implementation map. They include chain-specific/batch send variants,
recovery import/enrollment/sweep/threshold details, agent subroutes, allowance/
budget/escrow/policy editors, chain setup and swap. Representative family coverage
does not convert those entries into visual passes. Their shared component imports and
entry wiring are source-mapped; exhaustive per-route/state testing remains
additional coverage, not an external-credentials blocker.

External pixels: SDK-hosted sign-in/MFA/profile, wallet signing confirmation,
OS passkey and hardware dialogs, hosted Paystack/Korapay checkout. Those require
authorized configured providers/devices and were not fabricated or tested live.
No live wallet, financial request, account provisioning or deployment occurred.
Publication remains held for independent review, including any requested wider
route coverage and the separate published dependency-security failure.

## Historical initial evidence (published baseline)

Landing and chooser were rendered at six widths. WalletHero, RequestOverview and SignPayloadPreview were rendered in a synthetic fixture at those widths. Its approval pending/rejection/retry/cancel/history controls are synthetic. These checks do not cover authenticated route composition, provider popups or every app family.

Shared workspace padding, FormField sizing and review-surface spacing propagate beyond screenshots, but propagation is not visual verification. Existing colors and functional guards remain.

## Initial family gaps (before the local follow-up)

- **Public product marketing (8 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Settings and account (5 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Activity and inbox (5 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Governance and treasury (14 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Wallet home, detail and chain setup (9 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Recovery (7 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Agent workspace (17 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Payments and exchange (3 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Send and batch (9 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Authentication and onboarding (3 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Public information (3 entries):** representative desktop/mobile rendered review and loading/empty/error/dialog states pending.
- **Landing and product selection (2 entries):** landing/chooser covered; further states pending.

## Route inventory

| Route | Family | Source |
|---|---|---|
| `/agent` | Public product marketing | `apps/web/src/app/agent/page.tsx` |
| `/agents/[name]/[slug]` | Public product marketing | `apps/web/src/app/agents/[name]/[slug]/page.tsx` |
| `/agents` | Public product marketing | `apps/web/src/app/agents/page.tsx` |
| `/app/account` | Settings and account | `apps/web/src/app/app/account/page.tsx` |
| `/app/activity` | Activity and inbox | `apps/web/src/app/app/activity/page.tsx` |
| `/app/contacts` | Settings and account | `apps/web/src/app/app/contacts/page.tsx` |
| `/app/intents` | Governance and treasury | `apps/web/src/app/app/intents/page.tsx` |
| `/app/invitations` | Activity and inbox | `apps/web/src/app/app/invitations/page.tsx` |
| `/app/notifications/[id]` | Activity and inbox | `apps/web/src/app/app/notifications/[id]/page.tsx` |
| `/app/notifications` | Activity and inbox | `apps/web/src/app/app/notifications/page.tsx` |
| `/app` | Wallet home, detail and chain setup | `apps/web/src/app/app/page.tsx` |
| `/app/proposals/[proposal]` | Governance and treasury | `apps/web/src/app/app/proposals/[proposal]/page.tsx` |
| `/app/proposals` | Governance and treasury | `apps/web/src/app/app/proposals/page.tsx` |
| `/app/secure/[recovery]/enroll` | Recovery | `apps/web/src/app/app/secure/[recovery]/enroll/page.tsx` |
| `/app/secure/[recovery]` | Recovery | `apps/web/src/app/app/secure/[recovery]/page.tsx` |
| `/app/secure/[recovery]/sweep` | Recovery | `apps/web/src/app/app/secure/[recovery]/sweep/page.tsx` |
| `/app/secure/[recovery]/threshold` | Recovery | `apps/web/src/app/app/secure/[recovery]/threshold/page.tsx` |
| `/app/secure/import` | Recovery | `apps/web/src/app/app/secure/import/page.tsx` |
| `/app/secure/new` | Recovery | `apps/web/src/app/app/secure/new/page.tsx` |
| `/app/secure` | Recovery | `apps/web/src/app/app/secure/page.tsx` |
| `/app/security-architecture` | Settings and account | `apps/web/src/app/app/security-architecture/page.tsx` |
| `/app/settings` | Settings and account | `apps/web/src/app/app/settings/page.tsx` |
| `/app/wallet/[name]/activity` | Activity and inbox | `apps/web/src/app/app/wallet/[name]/activity/page.tsx` |
| `/app/wallet/[name]/agents/[agent]/connection` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/[agent]/connection/page.tsx` |
| `/app/wallet/[name]/agents/[agent]` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/[agent]/page.tsx` |
| `/app/wallet/[name]/agents/[agent]/strategy` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/[agent]/strategy/page.tsx` |
| `/app/wallet/[name]/agents/admin` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/admin/page.tsx` |
| `/app/wallet/[name]/agents/approvals` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/approvals/page.tsx` |
| `/app/wallet/[name]/agents/feedback` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/feedback/page.tsx` |
| `/app/wallet/[name]/agents/funding` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/funding/page.tsx` |
| `/app/wallet/[name]/agents/hyperliquid` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/hyperliquid/page.tsx` |
| `/app/wallet/[name]/agents/library` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/library/page.tsx` |
| `/app/wallet/[name]/agents/new` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/new/page.tsx` |
| `/app/wallet/[name]/agents` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/page.tsx` |
| `/app/wallet/[name]/agents/policy` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/policy/page.tsx` |
| `/app/wallet/[name]/agents/proposals/new` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/proposals/new/page.tsx` |
| `/app/wallet/[name]/agents/sessions/new` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/sessions/new/page.tsx` |
| `/app/wallet/[name]/agents/solana` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/solana/page.tsx` |
| `/app/wallet/[name]/agents/start` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/start/page.tsx` |
| `/app/wallet/[name]/agents/trades` | Agent workspace | `apps/web/src/app/app/wallet/[name]/agents/trades/page.tsx` |
| `/app/wallet/[name]/allowances` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/allowances/page.tsx` |
| `/app/wallet/[name]/budget` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/budget/page.tsx` |
| `/app/wallet/[name]/buy` | Payments and exchange | `apps/web/src/app/app/wallet/[name]/buy/page.tsx` |
| `/app/wallet/[name]/chains/add` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/chains/add/page.tsx` |
| `/app/wallet/[name]/chains` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/chains/page.tsx` |
| `/app/wallet/[name]/escrow` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/escrow/page.tsx` |
| `/app/wallet/[name]/members/add` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/members/add/page.tsx` |
| `/app/wallet/[name]/members` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/members/page.tsx` |
| `/app/wallet/[name]` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/page.tsx` |
| `/app/wallet/[name]/policies/[id]` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/policies/[id]/page.tsx` |
| `/app/wallet/[name]/policies/new` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/policies/new/page.tsx` |
| `/app/wallet/[name]/policies` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/policies/page.tsx` |
| `/app/wallet/[name]/policy` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/policy/page.tsx` |
| `/app/wallet/[name]/receive` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/receive/page.tsx` |
| `/app/wallet/[name]/recurring` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/recurring/page.tsx` |
| `/app/wallet/[name]/rules` | Governance and treasury | `apps/web/src/app/app/wallet/[name]/rules/page.tsx` |
| `/app/wallet/[name]/sell` | Payments and exchange | `apps/web/src/app/app/wallet/[name]/sell/page.tsx` |
| `/app/wallet/[name]/send/batch` | Send and batch | `apps/web/src/app/app/wallet/[name]/send/batch/page.tsx` |
| `/app/wallet/[name]/send/btc` | Send and batch | `apps/web/src/app/app/wallet/[name]/send/btc/page.tsx` |
| `/app/wallet/[name]/send/erc20` | Send and batch | `apps/web/src/app/app/wallet/[name]/send/erc20/page.tsx` |
| `/app/wallet/[name]/send/eth` | Send and batch | `apps/web/src/app/app/wallet/[name]/send/eth/page.tsx` |
| `/app/wallet/[name]/send` | Send and batch | `apps/web/src/app/app/wallet/[name]/send/page.tsx` |
| `/app/wallet/[name]/send/zec` | Send and batch | `apps/web/src/app/app/wallet/[name]/send/zec/page.tsx` |
| `/app/wallet/[name]/settings` | Settings and account | `apps/web/src/app/app/wallet/[name]/settings/page.tsx` |
| `/app/wallet/[name]/setup/erc20` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/setup/erc20/page.tsx` |
| `/app/wallet/[name]/setup/eth` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/setup/eth/page.tsx` |
| `/app/wallet/[name]/setup` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/[name]/setup/page.tsx` |
| `/app/wallet/[name]/swap` | Payments and exchange | `apps/web/src/app/app/wallet/[name]/swap/page.tsx` |
| `/app/wallet/new` | Authentication and onboarding | `apps/web/src/app/app/wallet/new/page.tsx` |
| `/app/wallet` | Wallet home, detail and chain setup | `apps/web/src/app/app/wallet/page.tsx` |
| `/changelog` | Public information | `apps/web/src/app/changelog/page.tsx` |
| `/choose` | Landing and product selection | `apps/web/src/app/choose/page.tsx` |
| `/connect` | Authentication and onboarding | `apps/web/src/app/connect/page.tsx` |
| `/p2pdefi` | Public product marketing | `apps/web/src/app/p2pdefi/page.tsx` |
| `/` | Landing and product selection | `apps/web/src/app/page.tsx` |
| `/payments` | Public product marketing | `apps/web/src/app/payments/page.tsx` |
| `/personal` | Public product marketing | `apps/web/src/app/personal/page.tsx` |
| `/privacy` | Public information | `apps/web/src/app/privacy/page.tsx` |
| `/pro` | Public product marketing | `apps/web/src/app/pro/page.tsx` |
| `/secure` | Public product marketing | `apps/web/src/app/secure/page.tsx` |
| `/security` | Public information | `apps/web/src/app/security/page.tsx` |
| `/send/batch` | Send and batch | `apps/web/src/app/send/batch/page.tsx` |
| `/send/eth` | Send and batch | `apps/web/src/app/send/eth/page.tsx` |
| `/send` | Send and batch | `apps/web/src/app/send/page.tsx` |
| `/welcome` | Authentication and onboarding | `apps/web/src/app/welcome/page.tsx` |

## Historical findings before connected-fixture review

- Public product pages still use a denser split hero and 20/32/40 px gutters, versus the refreshed landing rhythm.
- Several app-family headings remain hidden on mobile, while home now presents a visible heading. Need check shell title duplication before normalizing.
- Form, settings and list pages use different header-to-content and section spacing; blanket shell padding is insufficient.
- Loading skeletons, dialogs and recovery/agent stages require their own narrow-screen review; no new delayed reveal should hide risk, address, amount, threshold or recovery information.
- Real authentication, connected dashboard, provider dialogs, recovery devices and transactions remain configuration/live-test gates, not proven by fixtures.

## Historical first follow-up; not published

- One hydration-safe reduced-motion hook now serves 52 existing consumers. Server and first client output is visible/still; browser preference is applied after hydration. This fixes invisible initial content and conditional decorative DOM mismatches without hiding signing information.
- Notification permission and WebHID capability detection now defer until after hydration, eliminating two independently reproduced Settings mismatches.
- Public product marketing shares the wider gutters, section spacing and readable line-height of the landing direction. Shared PageEyebrow, RouteSkeleton and SendProgressStage spacing is aligned; skeleton animation respects reduced motion.
- People empty-state no longer reserves an almost full-screen void. Its actual add/cancel interaction was exercised.
- Agent dashboard uses the existing theme-aware surface rather than hard-coded dark background with light-theme text. Setup descriptions wrap inside their containing panel at 320 px.

Validation of this final local tree: production build exited 0; **243 suites / 1,918 tests**, **27 script tests**, lint/type checks and bundle gate passed. External wallet **1123.6 / 1124 kB**, legacy Turnkey **979.6 / 991 kB**. No budgets changed.

Rendered inventory: 11 actual page components at 390 and 1440 px with disconnected providers. Initial errors were recorded, not discarded; the targeted follow-up checked Settings, People, Recovery and Agent pages at 320, 390 and 1440 px with zero page errors and no horizontal overflow. People add/cancel and agent Advanced disclosure passed. Agent setup rows stay inside their panel. Public personal/agent/secure product, security/privacy/changelog, connect and welcome routes were inspected at 390 and 1440 px: 16 captures, zero page errors/overflow; welcome correctly redirected to connect.

These are not 38 authenticated journeys. Payment and new-recovery views stop at connection gates; proposals redirects; send showed only an incomplete/loading state. Those are explicitly **blocked/incomplete**, not passes for their full flows. Empty dashboard, empty activity, settings, People, setup and signed-out recovery are actual rendered components outside the authenticated shell. The shell, funded wallet detail, provider dialogs, full governance/treasury states, recovery devices and every chain-specific compose/review/error state remain unverified. The whole-app consistency condition is therefore **not satisfied yet**, and publication stays held.

Native unpublished review board: `libfile_c66bb7775a6c8191929032fc3b895754`, version 0, `clearsig-app-consistency-review-2026-10-06.png`. Local screenshots and machine-readable results: `/workspace/scratch/quantus-design/families/`.

## Published baseline terminal checks

`d751d94d1fd268084eaf164a1f2858a0622c8a25` was already pushed before the hold arrived. CI run `37495508332` succeeded. Vercel deployment `9Fui7qGQvzLp4qtkoxGBfQ8BMiG5` succeeded. Security run `37495508518` failed its frontend dependency audit (23 findings: 14 moderate, 9 high; production gate identified http-cache-semantics and source-map-js). CodeQL, tracked-secret scan and Rust dependency policy passed; dependency review was skipped on push. No history rewrite or subsequent publication.

## Final evidence and review board

Native Library board: **`libfile_26059a49295c8191932d3631ea7da63d`**, version **0**,
`clearsig-all-family-review-2026-10-06.png` (2,861,522 bytes).
SHA-256: `20e4df70298a3dff3f06b448fe2e65ecec7f70417755d1448e476cf145e49b45`.
It contains 12 desktop/mobile family pairs plus signing review, checkout error,
bank error and owner-dialog pairs. Actual screenshots, not design mockups.

Final browser evidence in `/workspace/scratch/app-wide-review/`:

- `matrix-results.json`: 52 connected route/state cases; 51 clean. Mobile send
  recorded two `Invalid or unexpected token` browser script errors during the
  development-server run. Cause was not established; this failed run is retained.
- `send-recheck/matrix-results.json`: both 390/1440 send cases passed with an
  explicit visible review-region assertion; clean captures replace the failed
  screenshot on the board. This is a targeted successful rerun, not a claim the
  original 52-case command exited successfully.
- `interaction-results.json`: 16 flows passed (eight at each width), including
  explicit checkout-error toast, bank retry, recovery confirmation, account form,
  wallet switch, signing review, owner focus containment and mocked auth handoff.
- `public-final-results.json`: 12 signed-out public cases passed (six routes at
  both widths), checking exact route, real heading, page errors and overflow.
- `narrow-dark-results.json`: 12 cases passed, six routes at 320/light and
  390/dark; agent dashboard readiness asserted. These replace the earlier agent
  scope-gate screenshots. Payment target sizing and proposal status contrast pass.
- Prior landing/chooser evidence remains applicable: six widths and reduced-motion,
  no-JS visibility, demo/repeat and navigation checks. The landing source was not
  changed by the payment/fixture follow-up.

The fixture preparer was validated in a fresh isolated directory, including
PostCSS config copying and dirty-source metadata. Focused lint and source diff
whitespace checks passed. Tests do not prove hosted auth, actual signing,
settlement or all individual chain-specific screens. Publication is still held.
