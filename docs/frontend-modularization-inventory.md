# Frontend modularization inventory

Measured with `npm run report:large-modules` on 2026-07-13. This inventory is
not a claim that these modules were fixed. It makes the remaining concentration
visible and gives each split a boundary.

| Lines | Module | Required split |
| ---: | --- | --- |
| 1,974 | `features/send/routes/SolanaSendPage.tsx` | form/view state, typed proposal controller, transaction receipt UI |
| 1,923 | `features/settings/routes/AppSettingsPage.tsx` | account, appearance, notifications, security settings |
| 1,864 | `features/wallet/routes/WalletHomePage.tsx` | data controller, balances/actions, protection summary, activity |
| 1,833 | `features/landing/routes/LandingPage.tsx` | product sections and page composition |
| 1,634 | `lib/agents/storage.ts` | profiles, policies, proposals, sessions, executions, audit storage repositories |
| 1,568 | `features/send/routes/BtcSendPage.tsx` | UTXO preparation, ClearSign lifecycle, wallet signing, receipt UI |
| 1,522 | `features/secure/routes/RecoverySweepPage.tsx` | recovery state machine, chain adapters, signing, receipt UI |
| 1,308 | `features/send/routes/EthSendPage.tsx` | EVM preparation, typed lifecycle, signing, receipt UI |
| 1,247 | `lib/agents/serverState.ts` | repositories, validation, owner approvals, scorecards, audit events |
| 1,144 | `features/send/routes/BatchSendPage.tsx` | row editor, validation, typed lifecycle, receipt UI |
| 1,137 | `features/send/routes/Erc20SendPage.tsx` | token metadata, EVM preparation, typed lifecycle, receipt UI |
| 1,086 | `features/secure/routes/ImportKeyPage.tsx` | parser, validation, import controller, confirmation UI |
| 1,059 | `components/landing/SecureSection.tsx` | content data and independent visual sections |
| 1,054 | `features/send/routes/ZecSendPage.tsx` | UTXO preparation, typed lifecycle, signing, receipt UI |
| 1,047 | `features/secure/routes/NewRecoveryPage.tsx` | form domain, creation controller, enrollment handoff |
| 1,037 | `features/secure/routes/RecoveryThresholdPage.tsx` | threshold domain, signing controller, confirmation UI |
| 1,028 | `features/treasury/routes/EscrowPage.tsx` | project repository, escrow controller, release/return views |

## Priority

1. Split `storage.ts` and `serverState.ts` first because they are shared mutable
   Agent boundaries with the widest correctness blast radius.
2. Split send routes around a common typed proposal state machine while keeping
   chain-specific transaction preparation in separate adapters.
3. Split Secure routes around an explicit recovery state machine before adding
   more recovery methods.
4. Split wallet/settings pages after their read models are extracted; visual
   decomposition alone will not reduce coupling.

CI already caps route entries at 1,000 lines, all modules at 2,000, Agent
feature modules at 900, and Agent controllers at 700. The inventory command is
the measurable queue for lowering those limits without pretending the current
files are acceptable.
