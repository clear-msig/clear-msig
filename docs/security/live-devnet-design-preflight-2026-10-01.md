# Wallet-to-approval design preflight

Starting point: published review commit `51d381d506cb9ed751560cdf43fba859f9a96c21`.
Parent visually confirmed that the newly attached approved image is the earlier
wallet-to-approval synthetic review board. The locally retained board at
`clearsig-oct1-review/clearsig-app-flow-review-2026-10-01.png` was inspected directly.
The newly attached Library bytes were not independently compared here.

## Production versus board

- `/app/wallet/[name]` already renders the actual `WalletHero` used in the board,
  with real portfolio/member/loading/approval inputs and a `WalletApprovalPanel`.
  The board's hand-written sample queue row and fixed balances are not production.
- `/app/proposals/[proposal]` already renders the actual `RequestOverview` and
  `SignPayloadPreview`, plus the subsequently added canonical action review,
  recovery notices, timeline, approver state and true workflow controls.
- The board's desktop two-column layout was fixture-only: production stacked the
  overview and review vertically. This local fix puts the overview beside the
  review/control column at desktop widths, with a sticky overview and a stacked
  mobile layout. Zero-bound minimum widths retain wrapping of complete addresses.
- The production sidebar/header/mobile navigation remain. The board's Wallet /
  Proposal / Approval hash tabs and demo callbacks are not shipped.
- This is not a pixel-identical replacement with synthetic content. Production
  retains the full canonical document, hashes, unknown-fee disclosure, signing
  identity, threshold, timelock and actual failure/reconciliation controls.
  No palette, signing, authorization, request state or provider code changed.

## Verification

An isolated harness imports the actual production proposal page directly, with
wallet/RPC/query/workflow boundaries mocked. It does not bypass live auth. Browser
captures at 1440, 390 and 320 px under reduced motion confirm side-by-side desktop
panels, stacked mobile panels, no horizontal overflow, no page exceptions and
visible fee-uncertainty details. Refresh and synthetic approval rejection follow
actual page event handlers; the normal error toast and expandable details appear.
No real signature, account, provider login or financial operation was exercised.

The complete preview-scoped production build passes: 222 suites / 1,727 tests,
20 script tests, lint/types/metadata/architecture, compilation/50 pages and the
approved preview budget gate. Maxima remain 998.5 / 1123.4 / 990.3 kB for standard /
external / Turnkey, with the existing 518 KiB preview chunk cap.

## Deployment handoff

Prepared locally only; not pushed or deployed. Exact live-devnet project/domain,
branch/source and network configuration must be verified before a live update.
The connected Vercel account still lacks `klubapp` / `clear-msig` scope according
to the parent's latest read. Reauthorize that project/team; do not use a main push
or a protection bypass to work around it. Hosted browser connectivity also remains
unverified after the previously recorded proxy CONNECT 403.

If the live-devnet target is a Vercel production environment, the original bundle
limits apply and still fail. The approved baseline is preview-only; this source
check does not authorize widening production budgets or promoting a preview to
avoid that gate. Existing live provider/settlement/agent readiness restrictions
remain unchanged.
