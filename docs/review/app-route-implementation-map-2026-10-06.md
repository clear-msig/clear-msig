# Route implementation and rendered coverage

85 entry points visited at 390/1440 in the existing dark theme using actual routes and controlled read-boundary fixtures. This is layout/state coverage, not proof of all possible states or live integrations. Redirects are explicitly distinguished from independent screens.

| Route | Family | Implementation references | Evidence |
|---|---|---|---|
| `/agent` | Public product marketing | `@/components/product/ProductSurfaceLanding` | r01 · 390/1440 dark · Public content / navigation rendered |
| `/agents/[name]/[slug]` | Public product marketing | `@/features/agents/server/serverState` | r02 · 390/1440 dark · Synthetic public trader profile; no live registry/performance |
| `/agents` | Public product marketing | `@/features/agents/server/serverState` | r03 · 390/1440 dark · Public marketplace with local registry fixture |
| `/app/account` | Settings and account | `@/components/settings/IdentityCard`, `@/components/settings/AppLockRow`, `@/components/settings/SignOutCard` | r04 · 390/1440 dark · Synthetic connected identity; signing unavailable |
| `/app/activity` | Activity and inbox | `@/components/activity/HistoryReadNotice` | r05 · 390/1440 dark · Synthetic waiting/ready history |
| `/app/contacts` | Settings and account | `@/components/retail/Button`, `@/components/retail/MemberAvatar`, `@/components/ui/Toast` | r06 · 390/1440 dark · Empty contacts and add action |
| `/app/intents` | Governance and treasury | `apps/web/src/app/app/intents/page.tsx` (inline page) | r07 · 390/1440 dark · Redirect to `/app/wallet/operations`; Public content / navigation rendered |
| `/app/invitations` | Activity and inbox | `@/components/retail/StickyTopBar`, `@/components/retail/MemberAvatar`, `@/components/ui/Toast` | r08 · 390/1440 dark · Empty invitations and authority notice |
| `/app/notifications/[id]` | Activity and inbox | `@/components/retail/Button` | r09 · 390/1440 dark · Synthetic notification detail |
| `/app/notifications` | Activity and inbox | `@/components/retail/Button` | r10 · 390/1440 dark · Synthetic notification list |
| `/app` | Wallet home, detail and chain setup | `apps/web/src/app/app/page.tsx` (inline page) | r11 · 390/1440 dark · Redirect to `/app/wallet/operations`; Public content / navigation rendered |
| `/app/proposals/[proposal]` | Governance and treasury | `@/components/proposals/ProposalVoteHistory`, `@/components/ui/Toast`, `@/components/retail/Button` | r12 · 390/1440 dark · Pending proposal: 1 of 2 approvals; no vote submitted |
| `/app/proposals` | Governance and treasury | `apps/web/src/app/app/proposals/page.tsx` (inline page) | r13 · 390/1440 dark · Redirect to `/app/wallet/operations`; Public content / navigation rendered |
| `/app/secure/[recovery]/enroll` | Recovery | `@/features/secure/infrastructure/useSecureOperation`, `@/components/retail/Button`, `@/components/retail/PageEyebrow` | r14 · 390/1440 dark · Passkey enrollment before OS prompt; two wallet confirmations disclosed |
| `/app/secure/[recovery]` | Recovery | `@/components/retail/MemberAvatar`, `@/components/retail/UsdHint` | r15 · 390/1440 dark · Synthetic recovery vault, threshold and balance |
| `/app/secure/[recovery]/sweep` | Recovery | `@/features/secure/routes/RecoverySweepPage` | r16 · 390/1440 dark · Sweep form; backup-required gate |
| `/app/secure/[recovery]/threshold` | Recovery | `@/features/secure/routes/RecoveryThresholdPage` | r17 · 390/1440 dark · Threshold chooser; no signature |
| `/app/secure/import` | Recovery | `@/features/secure/routes/ImportKeyPage` | r18 · 390/1440 dark · Import form; no private key entered |
| `/app/secure/new` | Recovery | `@/features/secure/routes/NewRecoveryPage` | r19 · 390/1440 dark · New recovery chooser |
| `/app/secure` | Recovery | `@/components/retail/Button`, `@/components/retail/UsdHint` | r20 · 390/1440 dark · Recovery overview |
| `/app/security-architecture` | Settings and account | `apps/web/src/app/app/security-architecture/page.tsx` (inline page) | r21 · 390/1440 dark · Architecture disclosure |
| `/app/settings` | Settings and account | `@/features/settings/routes/AppSettingsPage` | r22 · 390/1440 dark · App settings |
| `/app/wallet/[name]/activity` | Activity and inbox | `@/components/activity/HistoryReadNotice`, `@/components/retail/BrandSelect` | r23 · 390/1440 dark · Wallet activity with synthetic request |
| `/app/wallet/[name]/agents/[agent]/connection` | Agent workspace | `@/features/agents/infrastructure/inboxClient`, `@/components/ui/Toast`, `@/features/agents/infrastructure/inboxClient` | r24 · 390/1440 dark · Trader connection form; no connection created |
| `/app/wallet/[name]/agents/[agent]` | Agent workspace | `@/features/agents/routes/AgentDetailPage` | r25 · 390/1440 dark · Synthetic paused read-only trader |
| `/app/wallet/[name]/agents/[agent]/strategy` | Agent workspace | `@/components/ui/Toast`, `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/stateClient` | r26 · 390/1440 dark · Trading-plan editor; no save |
| `/app/wallet/[name]/agents/admin` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/agentStore`, `@/features/agents/infrastructure/feedbackStore` | r27 · 390/1440 dark · Debug admin enabled; unavailable readiness handled |
| `/app/wallet/[name]/agents/approvals` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/agentStore` | r28 · 390/1440 dark · Empty owner approvals |
| `/app/wallet/[name]/agents/feedback` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | r29 · 390/1440 dark · Feedback form; no submission |
| `/app/wallet/[name]/agents/funding` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/ui/AgentFundingReadStatus`, `@/features/agents/controllers/useAgentVaultFunding` | r30 · 390/1440 dark · Funding unavailable/retry; synthetic budget suggestion |
| `/app/wallet/[name]/agents/hyperliquid` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | r31 · 390/1440 dark · Venue setup; unavailable readiness, no credentials/orders |
| `/app/wallet/[name]/agents/library` | Agent workspace | `@/features/agents/routes/AgentLibraryPage` | r32 · 390/1440 dark · Trader recipe library |
| `/app/wallet/[name]/agents/new` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/stateClient`, `@/features/agents/infrastructure/agentStore` | r33 · 390/1440 dark · Create-trader form; no creation |
| `/app/wallet/[name]/agents` | Agent workspace | `@/features/agents/routes/AgentDashboardPage` | r34 · 390/1440 dark · Agent overview/readiness gates |
| `/app/wallet/[name]/agents/policy` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | r35 · 390/1440 dark · Risk controls; synthetic stored policy |
| `/app/wallet/[name]/agents/proposals/new` | Agent workspace | `@/components/ui/Toast`, `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/stateClient` | r36 · 390/1440 dark · Trade-idea form; no submission |
| `/app/wallet/[name]/agents/sessions/new` | Agent workspace | `@/components/agents/OwnerApprovalDialog`, `@/components/ui/Toast`, `@/features/agents/domain/runtime` | r37 · 390/1440 dark · Practice session form; no active trader |
| `/app/wallet/[name]/agents/solana` | Agent workspace | `@/components/retail/FormField`, `@/components/ui/Toast`, `@/features/agents/domain/runtime` | r38 · 390/1440 dark · Solana delegation form; no authority created |
| `/app/wallet/[name]/agents/start` | Agent workspace | `@/features/agents/routes/StartTradingPage` | r39 · 390/1440 dark · Practice readiness selection |
| `/app/wallet/[name]/agents/trades` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | r40 · 390/1440 dark · Empty trades; no execution |
| `/app/wallet/[name]/allowances` | Governance and treasury | `@/components/retail/BadgePill`, `@/components/retail/Breadcrumb`, `@/components/retail/StickyTopBar` | r41 · 390/1440 dark · Allowance editor; no signed mutation |
| `/app/wallet/[name]/budget` | Governance and treasury | `@/components/retail/Button`, `@/components/retail/ChainBadge`, `@/components/ui/Toast` | r42 · 390/1440 dark · Budget/guardrail controls; all six weekly inputs and units contained at 320/390/1440 |
| `/app/wallet/[name]/buy` | Payments and exchange | `@/components/retail/Button`, `@/components/ramp/RampStatusNotice`, `@/components/retail/BrandLoader` | r43 · 390/1440 dark · Buy entry; hosted checkout not invoked |
| `/app/wallet/[name]/chains/add` | Wallet home, detail and chain setup | `@/components/retail/Button`, `@/components/retail/BrandLoader`, `@/components/retail/ChainBadge` | r44 · 390/1440 dark · Network selection; no binding created |
| `/app/wallet/[name]/chains` | Wallet home, detail and chain setup | `@/components/retail/ChainBadge`, `@/components/retail/UsdHint` | r45 · 390/1440 dark · Synthetic network bindings/balances |
| `/app/wallet/[name]/escrow` | Governance and treasury | `@/features/treasury/routes/EscrowPage` | r46 · 390/1440 dark · Escrow project-record form; no custody claim |
| `/app/wallet/[name]/members/add` | Governance and treasury | `@/components/retail/Button`, `@/components/retail/MemberAvatar`, `@/components/retail/FormField` | r47 · 390/1440 dark · Member form with unavailable UpdateIntent authority gate |
| `/app/wallet/[name]/members` | Governance and treasury | `@/components/retail/BadgePill`, `@/components/retail/MemberAvatar`, `@/components/ui/Toast` | r48 · 390/1440 dark · Synthetic member list |
| `/app/wallet/[name]` | Wallet home, detail and chain setup | `@/components/retail/Button`, `@/components/wallet/detail/HoldingsPanel`, `@/components/wallet/detail/WalletApprovalPanel` | r49 · 390/1440 dark · Wallet detail; illustrative fiat values |
| `/app/wallet/[name]/policies/[id]` | Governance and treasury | `@/components/policies/PolicyForm` | r50 · 390/1440 dark · Existing local review-policy editor |
| `/app/wallet/[name]/policies/new` | Governance and treasury | `@/components/policies/PolicyForm` | r51 · 390/1440 dark · New review-policy editor |
| `/app/wallet/[name]/policies` | Governance and treasury | `@/components/ui/Toast` | r52 · 390/1440 dark · Local policy-authoring list |
| `/app/wallet/[name]/policy` | Governance and treasury | `@/components/retail/Button`, `@/components/policies/EnforcementLegend`, `@/components/ui/Toast` | r53 · 390/1440 dark · Protection settings and enforcement disclosure |
| `/app/wallet/[name]/receive` | Wallet home, detail and chain setup | `@/components/retail/ChainBadge`, `@/components/ui/Toast` | r54 · 390/1440 dark · Receive addresses from synthetic bindings |
| `/app/wallet/[name]/recurring` | Governance and treasury | `@/features/treasury/routes/RecurringPage` | r55 · 390/1440 dark · Recurring schedule form; no schedule created |
| `/app/wallet/[name]/rules` | Governance and treasury | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | r56 · 390/1440 dark · Rule details |
| `/app/wallet/[name]/sell` | Payments and exchange | `@/components/retail/Button`, `@/components/ramp/RampStatusNotice`, `@/components/retail/BrandLoader` | r57 · 390/1440 dark · Sell entry; hosted checkout not invoked |
| `/app/wallet/[name]/send/batch` | Send and batch | `@/features/send/routes/BatchSendPage` | r58 · 390/1440 dark · Batch recipient composer |
| `/app/wallet/[name]/send/btc` | Send and batch | `@/features/send/routes/BtcSendPage` | r59 · 390/1440 dark · Bitcoin inputs → complete review → action; repeated-edit retention verified; synthetic display params, empty UTXO set |
| `/app/wallet/[name]/send/erc20` | Send and batch | `@/features/send/routes/Erc20SendPage` | r60 · 390/1440 dark · ERC20 composer; no chain submission |
| `/app/wallet/[name]/send/eth` | Send and batch | `@/features/send/routes/EthSendPage` | r61 · 390/1440 dark · Ethereum composer; no chain submission |
| `/app/wallet/[name]/send` | Send and batch | `@/features/send/routes/SolanaSendPage` | r62 · 390/1440 dark · SOL composer; no signature |
| `/app/wallet/[name]/send/zec` | Send and batch | `@/features/send/routes/ZecSendPage` | r63 · 390/1440 dark · Zcash composer/configuration notice |
| `/app/wallet/[name]/settings` | Settings and account | `apps/web/src/app/app/wallet/[name]/settings/page.tsx` (inline page) | r64 · 390/1440 dark · Wallet settings |
| `/app/wallet/[name]/setup/erc20` | Wallet home, detail and chain setup | `@/components/review/LegacySetupNotice`, `@/components/ui/Toast`, `@/components/retail/Breadcrumb` | r65 · 390/1440 dark · Redirect to `/app/wallet/operations/send/erc20`; Configured redirect; also unconfigured token setup at both widths |
| `/app/wallet/[name]/setup/eth` | Wallet home, detail and chain setup | `@/components/review/LegacySetupNotice`, `@/components/retail/NextStepCard`, `@/components/ui/Toast` | r66 · 390/1440 dark · Redirect to `/app/wallet/operations/send/eth`; Configured redirect; also unconfigured binding notice at both widths |
| `/app/wallet/[name]/setup` | Wallet home, detail and chain setup | `@/components/review/LegacySetupNotice`, `@/components/ui/Toast`, `@/components/retail/Breadcrumb` | r67 · 390/1440 dark · Redirect to `/app/wallet/operations`; Configured redirect; also unconfigured SOL setup at both widths |
| `/app/wallet/[name]/swap` | Payments and exchange | `@/components/retail/Button`, `@/components/retail/ChainBadge`, `@/components/retail/SendAmountField` | r68 · 390/1440 dark · Swap form; no executable quote |
| `/app/wallet/new` | Authentication and onboarding | `@/components/review/LegacySetupNotice`, `@/components/ui/Toast`, `@/components/retail/UnsupportedSignerBanner` | r69 · 390/1440 dark · Create-wallet form; redundant mobile create action hidden |
| `/app/wallet` | Wallet home, detail and chain setup | `@/features/wallet/routes/WalletHomePage` | r70 · 390/1440 dark · Synthetic wallet overview |
| `/changelog` | Public information | `apps/web/src/app/changelog/page.tsx` (inline page) | r71 · 390/1440 dark · Public content / navigation rendered |
| `/choose` | Landing and product selection | `@/components/product/ProductChooser` | r72 · 390/1440 dark · Public content / navigation rendered |
| `/connect` | Authentication and onboarding | `apps/web/src/app/connect/page.tsx` (inline page) | r73 · 390/1440 dark · App-owned sign-in entry; hosted authentication untested |
| `/p2pdefi` | Public product marketing | `@/components/product/ProductSurfaceLanding` | r74 · 390/1440 dark · Public content / navigation rendered |
| `/` | Landing and product selection | `@/features/landing/routes/LandingPage` | r75 · 390/1440 dark · Landing; existing palette and reveal behavior preserved |
| `/payments` | Public product marketing | `@/components/product/ProductSurfaceLanding` | r76 · 390/1440 dark · Public content / navigation rendered |
| `/personal` | Public product marketing | `@/components/product/ProductSurfaceLanding` | r77 · 390/1440 dark · Public content / navigation rendered |
| `/privacy` | Public information | `@/components/landing/LandingChrome`, `@/components/landing/LandingScrollUI` | r78 · 390/1440 dark · Public content / navigation rendered |
| `/pro` | Public product marketing | `@/components/product/ProductSurfaceLanding` | r79 · 390/1440 dark · Public content / navigation rendered |
| `/secure` | Public product marketing | `@/components/product/ProductSurfaceLanding` | r80 · 390/1440 dark · Public content / navigation rendered |
| `/security` | Public information | `@/components/landing/LandingChrome`, `@/components/landing/LandingScrollUI` | r81 · 390/1440 dark · Public content / navigation rendered |
| `/send/batch` | Send and batch | `apps/web/src/app/send/batch/page.tsx` (inline page) | r82 · 390/1440 dark · Redirect to `/app/wallet/operations/send/batch`; Public content / navigation rendered |
| `/send/eth` | Send and batch | `apps/web/src/app/send/eth/page.tsx` (inline page) | r83 · 390/1440 dark · Redirect to `/app/wallet/operations/send/eth`; Public content / navigation rendered |
| `/send` | Send and batch | `apps/web/src/app/send/page.tsx` (inline page) | r84 · 390/1440 dark · Redirect to `/app/wallet/operations/send`; Public content / navigation rendered |
| `/welcome` | Authentication and onboarding | `apps/web/src/app/welcome/page.tsx` (inline page) | r85 · 390/1440 dark · Redirect to `/connect`; Welcome alias to sign-in entry |

## Verification boundary

Compiled fixture sweep: 170/170 cases, no captured page/script errors or horizontal overflow. Ten entry points redirect in the seeded configured scenario; they are not ten additional layouts. Setup variants add six cases. Full-height captures are retained locally. Signing and all API/external requests are blocked. Public profiles, balances, policy storage, proposals and chain bindings are synthetic.

Specialist empty/unavailable states above are intentional evidence, not claims of provider readiness. All hosted authentication/checkout, wallet confirmations, OS/passkey/hardware prompts and live settlement remain untested. The owner-dialog and onboarding checks separately cover light/dark and short mobile viewports.
