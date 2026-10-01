# Wallet, proposal and approval consistency review

This continuation starts from `c9a23b1f` and preserves the original theme tokens,
including the existing dark/light preferences. No trading, payment, signature,
provider, on-chain program or approval mutation behavior is changed.

## Production changes

- WalletHero uses a larger heading/balance hierarchy, clearer action targets and
  consistent surface edges. Existing product routes and balance privacy remain.
  Policy/queue/member stats stay visible on mobile. The static claims Protection
  On / Trader Ready / Risk Guarded were replaced with policy-review or gated
  language; they were not derived health checks. The illustrative fiat-price
  caveat is visible beside the balance rather than only in a tooltip.
- RequestOverview is extracted and wired into the actual proposal route. Its
  title remains visible on mobile, its denominator is the required threshold,
  eligible membership is separate, and the complete request account is visible.
  Existing share/print/explorer controls and mutation handlers remain in place.
- SignPayloadPreview adopts the same readable receipt structure. All supplied
  fields are now inline, including contract, source address, hashes and payload
  fields previously classed as technical. The compatibility collapse prop no
  longer hides them. Long values wrap; warnings and notes remain visible.
- The approval inbox obtains the actual threshold from its already fetched
  intent. It no longer presents total eligible members as required approvals.
  Missing intent/threshold state is explicit instead of guessing a denominator.

## Rendered evidence and limits

Board: `libfile_5d74d5fdf00881919785fe3370dea478`, version 0, file
`file_0000000031c481f49fe352bf907514d2`, 526319 bytes. SHA256:
`40ad2606f671df3f14c3d8b8a5f0f504d884943708978cbb5ba9c0616428c999`.

The board renders actual WalletHero, RequestOverview, SignPayloadPreview and
Button components inside a separate provider-free fixture. Data, the inbox
example, navigation between fixture screens and wallet rejection/retry/cancel
callbacks are synthetic. This is not the live authenticated route shell, a real
proposal preparation response, signing verification or execution. The fixture
is outside the production checkout and is not committed as a bypass route.

The fixture supplies a full synthetic transfer review to demonstrate the shared
component. Production callers retain their existing data sources: this change
exposes all supplied fields, but does not invent missing typed-payload decoding,
fee estimates or fetch new canonical preparation data. In particular, the
proposal route's existing generic approval summary still receives wallet/role/
creation/quorum metadata; this board must not be described as proof that every
proposal kind already supplies full amount/recipient/permission fields. Closing
that data-coverage gap requires an audited integration with canonical descriptor
preparation and per-action rendering, not made-up UI values.

Captures cover wallet/proposal/approval at 320, 390 and 1440 widths. The native
board includes desktop wallet/proposal and the three full mobile screens. No
horizontal overflow was found; complete addresses are wrapped, not truncated.
Light mode remains supported and was also exercised. Real auth, wallet signing,
fees, deposits and financial actions were not tested.

## Validation

- Full verification: 180 Vitest files / 1,134 tests plus 14 script tests passed;
  architecture, intent/metadata, lint and TypeScript checks passed.
- New rendered-markup regressions assert that legacy collapse callers cannot
  hide supplied source/destination/contract/fee/permission/risk details, and
  separate threshold, membership and full proposal identity.
- Production build passed, 50 static pages generated.
- Bundle gate remains failing: 535.7/506 kB largest chunk; 1009.9/971 standard
  authenticated route; 1138.8/1100 external runtime; 999.7/954 Turnkey. The shared
  presentation adds approximately 0.9 kB to the peak route versus the preceding
  checkpoint. Limits and SDK versions were not loosened.
- Browser flows passed at 320/390/1440 dark and 390 light: actual balance
  privacy toggle, keyboard navigation, back/forward, all supplied security
  details visible, and no overflow. Synthetic pending disables both fixture
  actions; rejection, retry and cancel states passed. These callbacks do not
  test the production wallet/signature mutations.

No source push, deployment, credential setup or live financial operation.

## Canonical approval follow-up

The production approval data gap described above is addressed for the supported
full-profile v4 action kinds in [the canonical review report](../security/canonical-approval-review-2026-10-01.md). That report records the exact unsupported/blocked cases, final checks and configuration requirements. Its captures are still synthetic component evidence, not live signing verification.
