# Route implementation and rendered coverage

85 entry points. Source mapping is not a visual pass. Parameterized routes use synthetic fixture identities. Redirect aliases are not independent screens.

| Route | Family | Implementation references | Evidence |
|---|---|---|---|
| `/agent` | Public product marketing | `@/components/product/ProductSurfaceLanding` | Representative rendered |
| `/agents/[name]/[slug]` | Public product marketing | `@/features/agents/server/serverState` | Source mapped; not individually rendered |
| `/agents` | Public product marketing | `@/features/agents/server/serverState` | Source mapped; not individually rendered |
| `/app/account` | Settings and account | `@/components/settings/IdentityCard`, `@/components/settings/AppLockRow`, `@/components/settings/SignOutCard` | Representative rendered |
| `/app/activity` | Activity and inbox | `@/components/activity/HistoryReadNotice` | Representative rendered |
| `/app/contacts` | Settings and account | `@/components/retail/Button`, `@/components/retail/MemberAvatar`, `@/components/ui/Toast` | Representative rendered |
| `/app/intents` | Governance and treasury | `apps/web/src/app/app/intents/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/app/invitations` | Activity and inbox | `@/components/retail/StickyTopBar`, `@/components/retail/MemberAvatar`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/notifications/[id]` | Activity and inbox | `@/components/retail/Button` | Source mapped; not individually rendered |
| `/app/notifications` | Activity and inbox | `@/components/retail/Button` | Representative rendered |
| `/app` | Wallet home, detail and chain setup | `apps/web/src/app/app/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/app/proposals/[proposal]` | Governance and treasury | `@/components/proposals/ProposalVoteHistory`, `@/components/ui/Toast`, `@/components/retail/Button` | Representative rendered |
| `/app/proposals` | Governance and treasury | `apps/web/src/app/app/proposals/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/app/secure/[recovery]/enroll` | Recovery | `@/features/secure/infrastructure/useSecureOperation`, `@/components/retail/Button`, `@/components/retail/PageEyebrow` | Source mapped; not individually rendered |
| `/app/secure/[recovery]` | Recovery | `@/components/retail/MemberAvatar`, `@/components/retail/UsdHint` | Source mapped; not individually rendered |
| `/app/secure/[recovery]/sweep` | Recovery | `@/features/secure/routes/RecoverySweepPage` | Source mapped; not individually rendered |
| `/app/secure/[recovery]/threshold` | Recovery | `@/features/secure/routes/RecoveryThresholdPage` | Source mapped; not individually rendered |
| `/app/secure/import` | Recovery | `@/features/secure/routes/ImportKeyPage` | Source mapped; not individually rendered |
| `/app/secure/new` | Recovery | `@/features/secure/routes/NewRecoveryPage` | Representative rendered |
| `/app/secure` | Recovery | `@/components/retail/Button`, `@/components/retail/UsdHint` | Representative rendered |
| `/app/security-architecture` | Settings and account | `apps/web/src/app/app/security-architecture/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/app/settings` | Settings and account | `@/features/settings/routes/AppSettingsPage` | Representative rendered |
| `/app/wallet/[name]/activity` | Activity and inbox | `@/components/activity/HistoryReadNotice`, `@/components/retail/BrandSelect` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/[agent]/connection` | Agent workspace | `@/features/agents/infrastructure/inboxClient`, `@/components/ui/Toast`, `@/features/agents/infrastructure/inboxClient` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/[agent]` | Agent workspace | `@/features/agents/routes/AgentDetailPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/[agent]/strategy` | Agent workspace | `@/components/ui/Toast`, `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/stateClient` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/admin` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/agentStore`, `@/features/agents/infrastructure/feedbackStore` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/approvals` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/agentStore` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/feedback` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/funding` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/ui/AgentFundingReadStatus`, `@/features/agents/controllers/useAgentVaultFunding` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/hyperliquid` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/library` | Agent workspace | `@/features/agents/routes/AgentLibraryPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/new` | Agent workspace | `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/stateClient`, `@/features/agents/infrastructure/agentStore` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents` | Agent workspace | `@/features/agents/routes/AgentDashboardPage` | Representative rendered |
| `/app/wallet/[name]/agents/policy` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/proposals/new` | Agent workspace | `@/components/ui/Toast`, `@/features/agents/domain/runtime`, `@/features/agents/infrastructure/stateClient` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/sessions/new` | Agent workspace | `@/components/agents/OwnerApprovalDialog`, `@/components/ui/Toast`, `@/features/agents/domain/runtime` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/solana` | Agent workspace | `@/components/retail/FormField`, `@/components/ui/Toast`, `@/features/agents/domain/runtime` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/start` | Agent workspace | `@/features/agents/routes/StartTradingPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/agents/trades` | Agent workspace | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/allowances` | Governance and treasury | `@/components/retail/BadgePill`, `@/components/retail/Breadcrumb`, `@/components/retail/StickyTopBar` | Source mapped; not individually rendered |
| `/app/wallet/[name]/budget` | Governance and treasury | `@/components/retail/Button`, `@/components/retail/ChainBadge`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/buy` | Payments and exchange | `@/components/retail/Button`, `@/components/ramp/RampStatusNotice`, `@/components/retail/BrandLoader` | Representative rendered |
| `/app/wallet/[name]/chains/add` | Wallet home, detail and chain setup | `@/components/retail/Button`, `@/components/retail/BrandLoader`, `@/components/retail/ChainBadge` | Source mapped; not individually rendered |
| `/app/wallet/[name]/chains` | Wallet home, detail and chain setup | `@/components/retail/ChainBadge`, `@/components/retail/UsdHint` | Source mapped; not individually rendered |
| `/app/wallet/[name]/escrow` | Governance and treasury | `@/features/treasury/routes/EscrowPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/members/add` | Governance and treasury | `@/components/retail/Button`, `@/components/retail/MemberAvatar`, `@/components/retail/FormField` | Source mapped; not individually rendered |
| `/app/wallet/[name]/members` | Governance and treasury | `@/components/retail/BadgePill`, `@/components/retail/MemberAvatar`, `@/components/ui/Toast` | Representative rendered |
| `/app/wallet/[name]` | Wallet home, detail and chain setup | `@/components/retail/Button`, `@/components/wallet/detail/HoldingsPanel`, `@/components/wallet/detail/WalletApprovalPanel` | Representative rendered |
| `/app/wallet/[name]/policies/[id]` | Governance and treasury | `@/components/policies/PolicyForm` | Source mapped; not individually rendered |
| `/app/wallet/[name]/policies/new` | Governance and treasury | `@/components/policies/PolicyForm` | Source mapped; not individually rendered |
| `/app/wallet/[name]/policies` | Governance and treasury | `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/policy` | Governance and treasury | `@/components/retail/Button`, `@/components/policies/EnforcementLegend`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/receive` | Wallet home, detail and chain setup | `@/components/retail/ChainBadge`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/recurring` | Governance and treasury | `@/features/treasury/routes/RecurringPage` | Representative rendered |
| `/app/wallet/[name]/rules` | Governance and treasury | `@/components/retail/Button`, `@/components/retail/FormField`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/sell` | Payments and exchange | `@/components/retail/Button`, `@/components/ramp/RampStatusNotice`, `@/components/retail/BrandLoader` | Representative rendered |
| `/app/wallet/[name]/send/batch` | Send and batch | `@/features/send/routes/BatchSendPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/send/btc` | Send and batch | `@/features/send/routes/BtcSendPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/send/erc20` | Send and batch | `@/features/send/routes/Erc20SendPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/send/eth` | Send and batch | `@/features/send/routes/EthSendPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/send` | Send and batch | `@/features/send/routes/SolanaSendPage` | Representative rendered |
| `/app/wallet/[name]/send/zec` | Send and batch | `@/features/send/routes/ZecSendPage` | Source mapped; not individually rendered |
| `/app/wallet/[name]/settings` | Settings and account | `apps/web/src/app/app/wallet/[name]/settings/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/app/wallet/[name]/setup/erc20` | Wallet home, detail and chain setup | `@/components/review/LegacySetupNotice`, `@/components/ui/Toast`, `@/components/retail/Breadcrumb` | Source mapped; not individually rendered |
| `/app/wallet/[name]/setup/eth` | Wallet home, detail and chain setup | `@/components/review/LegacySetupNotice`, `@/components/retail/NextStepCard`, `@/components/ui/Toast` | Source mapped; not individually rendered |
| `/app/wallet/[name]/setup` | Wallet home, detail and chain setup | `@/components/review/LegacySetupNotice`, `@/components/ui/Toast`, `@/components/retail/Breadcrumb` | Source mapped; not individually rendered |
| `/app/wallet/[name]/swap` | Payments and exchange | `@/components/retail/Button`, `@/components/retail/ChainBadge`, `@/components/retail/SendAmountField` | Source mapped; not individually rendered |
| `/app/wallet/new` | Authentication and onboarding | `@/components/review/LegacySetupNotice`, `@/components/ui/Toast`, `@/components/retail/UnsupportedSignerBanner` | Representative rendered |
| `/app/wallet` | Wallet home, detail and chain setup | `@/features/wallet/routes/WalletHomePage` | Representative rendered |
| `/changelog` | Public information | `apps/web/src/app/changelog/page.tsx` (inline page) | Representative rendered |
| `/choose` | Landing and product selection | `@/components/product/ProductChooser` | Representative rendered |
| `/connect` | Authentication and onboarding | `apps/web/src/app/connect/page.tsx` (inline page) | Representative rendered |
| `/p2pdefi` | Public product marketing | `@/components/product/ProductSurfaceLanding` | Source mapped; not individually rendered |
| `/` | Landing and product selection | `@/features/landing/routes/LandingPage` | Representative rendered |
| `/payments` | Public product marketing | `@/components/product/ProductSurfaceLanding` | Source mapped; not individually rendered |
| `/personal` | Public product marketing | `@/components/product/ProductSurfaceLanding` | Representative rendered |
| `/privacy` | Public information | `@/components/landing/LandingChrome`, `@/components/landing/LandingScrollUI` | Representative rendered |
| `/pro` | Public product marketing | `@/components/product/ProductSurfaceLanding` | Source mapped; not individually rendered |
| `/secure` | Public product marketing | `@/components/product/ProductSurfaceLanding` | Representative rendered |
| `/security` | Public information | `@/components/landing/LandingChrome`, `@/components/landing/LandingScrollUI` | Representative rendered |
| `/send/batch` | Send and batch | `apps/web/src/app/send/batch/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/send/eth` | Send and batch | `apps/web/src/app/send/eth/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/send` | Send and batch | `apps/web/src/app/send/page.tsx` (inline page) | Source mapped; not individually rendered |
| `/welcome` | Authentication and onboarding | `apps/web/src/app/welcome/page.tsx` (inline page) | Redirect observed to /connect |
