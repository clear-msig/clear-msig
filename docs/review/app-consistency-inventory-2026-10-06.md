# App consistency inventory — 6 October 2026

Published baseline: `d751d94d1fd268084eaf164a1f2858a0622c8a25`. Further publication is held pending app-wide review.

85 page entry points, including aliases and redirects; these are not 85 verified independent screens.

## Initial evidence (published baseline)

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

## Known inconsistencies to resolve locally

- Public product pages still use a denser split hero and 20/32/40 px gutters, versus the refreshed landing rhythm.
- Several app-family headings remain hidden on mobile, while home now presents a visible heading. Need check shell title duplication before normalizing.
- Form, settings and list pages use different header-to-content and section spacing; blanket shell padding is insufficient.
- Loading skeletons, dialogs and recovery/agent stages require their own narrow-screen review; no new delayed reveal should hide risk, address, amount, threshold or recovery information.
- Real authentication, connected dashboard, provider dialogs, recovery devices and transactions remain configuration/live-test gates, not proven by fixtures.

## Local follow-up completed; not published

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
