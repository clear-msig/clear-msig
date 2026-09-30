# Landing flow review — September 30, 2026

The latest user direction supersedes the earlier sage recoloring: preserve the
original ClearSig palette and improve functionality, flow, breathing room and
gradual reveals. This update restores the original Obsidian & Lime dark accent
`#ccff00`, its hover/bright variants, and the original light accent `#4d7c0f`.
Existing RGB channels and opacity utilities remain intact. SDK modal branding,
static accent treatments and theme-preview swatches are restored selectively;
security changes are not reverted.

The landing retains the reviewed compact composition and readable approval
workspace. The same illustrative 5 SOL request is explained through action,
policy and people. The demo changes local presentation only and never requests
a wallet connection, signature or transaction. Agent external execution is
explicitly labelled gated. Preview navigation and test-funds disclosure remain
visible before the demonstration.

Three below-the-fold explanation chapters reveal progressively using the
existing IntersectionObserver component. Content is visible in server HTML;
reduced motion, no JavaScript, print and keyboard focus preserve access. The
transition is 350ms / 10px. Primary controls and the approval workspace are never
scroll-hidden. No scroll locking or continuous decorative animation is used.

## Evidence and limits

- Local Chromium screenshots: 1440×900, 390×844 and 320×844; no horizontal
  overflow or page errors; amount and destination start above the mobile fold.
- Repeat demo/reset, policy disclosure, anchor navigation, all three reveals,
  reduced-motion switching, keyboard skip link and no-JavaScript content pass.
- Full frontend verification: 175 test files / 1,026 tests plus 14 script tests,
  intent/metadata/architecture gates, ESLint and TypeScript pass.
- Restored-palette production compilation, lint/type validation, all 50 static
  pages and build tracing completed with exit 0. The separate wallet-SDK bundle
  gate remains a release blocker; limits have not been changed.
- Authenticated app and wallet/provider/payment behavior is not established by
  these public-page checks. No live action or code push was performed.

## App-wide review in progress

85 route entries (67 app entries) are inventoried by screen/state family.
Inventory and source inspection are not full rendered acceptance. Concrete
follow-ups include post-login wallet-selection theme consistency, tiny receipt
labels, 28px decision-detail controls / 32px agent actions, mobile settings
navigation, and invalid escrow-field focus with draft retention.

A separate synthetic wallet → proposal → approval HTML fixture explores state
and navigation structure. It is not wired into the application or authentication
and is not evidence of real signing. Its visual propagation is paused pending
feedback; original palette is the constraint for subsequent implementation.
