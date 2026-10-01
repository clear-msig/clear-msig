# Local browser review screenshots

Rendered with Chromium and Playwright against the local production frontend.
Desktop: 1440 × 1000; mobile: 390 × 844. Full-page images may be taller.

These capture the public, signed-out UI from local refinement commit
`ad1acc2b381782037ede81e49c3362096fc3c74a`, based on published commit
`7f804704f79a64489b7027da114de703b3fed14b`. This screenshot-only commit
does not include those code refinements or deploy them.

External auth, backend API and RPC requests were blocked. No successful
login, wallet signature, payment or transaction was simulated or performed.
The sign-in screenshots deliberately show the provider-unavailable recovery
state. Landing receipts are explicitly illustrative. Reduced motion was used
for readable full-page captures.

- [Desktop landing — viewport](clearsig-desktop-landing-viewport.png)
- [Mobile landing — viewport](clearsig-mobile-landing-viewport.png)
- [Desktop landing — full page](clearsig-desktop-landing.png)
- [Mobile landing — full page](clearsig-mobile-landing.png)
- [Desktop product chooser](clearsig-desktop-products.png)
- [Mobile product chooser](clearsig-mobile-products.png)
- [Desktop sign-in unavailable](clearsig-desktop-sign-in-unavailable.png)
- [Mobile sign-in unavailable](clearsig-mobile-sign-in-unavailable.png)

The production compiler passes, but unchanged bundle budgets still fail.
These images are appearance and public-flow evidence, not deployed-system
or authenticated integration verification.
