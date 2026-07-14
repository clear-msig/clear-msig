# Frontend modularization inventory

Measured with `npm run report:large-modules` on 2026-07-13. This inventory is
not a claim that these modules were fixed. It makes the remaining concentration
visible and gives each split a boundary.

| Lines | Module | Required split |
| ---: | --- | --- |
| 1,833 | `features/landing/routes/LandingPage.tsx` | product sections and page composition |
| 1,522 | `features/secure/routes/RecoverySweepPage.tsx` | recovery state machine, chain adapters, signing, receipt UI |
| 1,086 | `features/secure/routes/ImportKeyPage.tsx` | parser, validation, import controller, confirmation UI |
| 1,059 | `components/landing/SecureSection.tsx` | content data and independent visual sections |
| 1,047 | `features/secure/routes/NewRecoveryPage.tsx` | form domain, creation controller, enrollment handoff |
| 1,037 | `features/secure/routes/RecoveryThresholdPage.tsx` | threshold domain, signing controller, confirmation UI |
| 1,033 | `features/treasury/routes/EscrowPage.tsx` | project repository, escrow controller, release/return views |

## Completed in this phase

- All six send routes are below 1,000 lines. Chain orchestration remains in
  routes while compose/result rendering, batch parsing, and CSV download live
  in UI, domain, and infrastructure modules respectively.
- Browser Agent state moved from the 1,634-line `lib/agents/storage.ts` into
  feature-owned repositories. The largest active local-state module is 648
  lines; the legacy entry is a 44-line compatibility facade.
- Server Agent state moved from the 1,246-line `lib/agents/serverState.ts` into
  feature-owned persistence, validation, signature, scorecard, and state
  modules. The largest active server-state module is 664 lines; the legacy
  entry is a 26-line compatibility facade.
- CI caps send routes at 1,000 lines, Agent state modules at 700, and rejects
  imports that bypass the feature-owned state boundary.

## Priority

1. Split Secure routes around an explicit recovery state machine before adding
   more recovery methods.
2. Continue moving pure Agent domain implementations out of `lib/agents`; the
   state boundary is migrated, but the wider domain migration is not complete.
3. Split wallet/settings pages after their read models are extracted; visual
   decomposition alone will not reduce coupling.

CI already caps route entries at 1,000 lines, all modules at 2,000, Agent
feature modules at 900, and Agent controllers at 700. The inventory command is
the measurable queue for lowering those limits without pretending the current
files are acceptable.
