# App design and landing motion review — 7 October 2026

Local changes based on published `ae1b817b5a0939e62b72800bf509c2db982da67a` and local motion commit `ce6541cf`. No new push or deployment. This pass changes visual presentation only; auth, policy, signing, transaction, settlement and trading behavior are unchanged. Existing black/lime and light-theme colors are retained.

## Changes

- The existing authored C moves from the landing hero into a faint background as native scrolling continues. Reverse scrolling restores its position. No pinned sections, scroll locking, video or WebGL runtime. Reduced motion uses a stationary watermark; no-JavaScript content stays readable.
- Mobile hero height follows its content, removing the empty tail after the CTA. The C fades earlier behind the headline/disclosure. Request, rules and approvers form a continuous narrative with one-time modest reveals and immediate keyboard-focus visibility.
- Shared app headings use the already licensed, locally hosted display face; amounts, addresses, controls and body text retain the compact task font. Surfaces, public navigation, chooser and app navigation use consistent geometry.
- Buttons draw chamfered backgrounds without clipping their real hit areas or focus outlines. Mobile primary navigation remains at least 48px for the central action. Approval receipt content and warning semantics are unchanged.
- Authenticated pages use a static decorative SVG background (219,910 bytes / 50,642 gzip), avoiding the landing geometry/scroll JavaScript in the authenticated bundle. It ignores pointer events and tracks the sidebar boundary. Missing artwork or font does not prevent form use.

## Validation

| Check | Result and scope |
|---|---|
| Final `npm run verify` | PASS: 249 test files, 1,947 tests; 27 script tests, zero skipped. Includes Redis-backed tests, metadata/intent/architecture checks, lint and TypeScript. |
| Production build | PASS: final webpack production compile and unchanged bundle gates. |
| Bundle measurements | Authenticated maximum 987.6/999 kB gzip; external-wallet profile 1123.5/1124; legacy Turnkey 979.4/991; chunks within 518 kB. These are current ratchets, not the long-term 250/150 kB targets. No limits or dependencies changed in this pass. |
| Route sweep | PASS: 85 route entries × 390/768/1440 widths = 255 captures, no overflow, script failures or error boundaries. Includes redirects, not 85 independent layouts. All 12 inventory families covered. |
| Page/state matrix | PASS: 52 cases, including empty/loading/error wallet, bank, review and activity states. |
| Interaction flows | PASS: 16 flows across mobile/desktop: wallet switch/Escape, payment input/full address/error, bank retry, recovery confirmation/cancel, app-lock form, signing review cancel/reopen/fixture boundary, owner dialog, synthetic auth handoff exactly once. |
| Narrow/theme checks | PASS: 12 cases, 320px light and 390px dark; no overflow, sampled status contrast >=4.5, checkout touch target >=44px. This is not an exhaustive WCAG audit. |
| Layers/assets | PASS: 5 cases covering actual owner dialog, inert background, focus trap, hit testing, nested scroll, sidebar collapse, unclipped primary focus, route unmount and missing font/art asset. |
| Onboarding/dialog clearance | PASS: 10 cases across desktop/mobile/light/dark, including 390×500 onboarding CTA clearance, focus restoration and a diagnostic external-overlay probe. The probe does not verify real hosted provider UI. |
| Landing motion matrix | PASS: 12 cases (1180/1440/768/390/320 normal/reduced plus no-JS desktop/mobile). Repeated demo, nav, keyboard skip, reveal alignment and no overflow/errors. |
| Motion acceptance | PASS: 9 cases covering immediate reversal, stationary reduced-motion background, resize/orientation, anchors/reload, diagnostic dialog layering and no-JS/font failure. Two additional wheel/history cases passed. |
| Production browser smoke | Landing and chooser are independently rendered. `/personal`, `/security` and `/changelog` are blocked with dummy local auth configuration and external network disabled: their unchanged public-auth boundary loads Dynamic before rendering content. Fixture rendering of those routes passed; real-provider rendering is not verified. |
| Rust/SBF | Not rerun: no root Rust or on-chain changes in this visual pass. Prior validation is not represented as a fresh run. |

The machine-readable route ledger is `app-design-route-coverage-2026-10-07.json`. The existing implementation map `app-route-implementation-map-2026-10-06.md` maps each route to source components; this pass rechecked the exact unchanged 85-entry set and added tablet coverage.

## Evidence and boundaries

Browser automation ran real production components against local synthetic read/provider fixtures. All signing/write methods reject; external browser requests, API/RPC submissions and device enrollment are blocked. Public registry data is an explicitly typed local fixture. An initial fixture alias failed to intercept that server read; its partial run was discarded, the read boundary corrected, and all 255 cases rerun successfully. This does not establish real registry, wallet-provider, authentication, payment, settlement, exchange, recovery-device or venue execution functionality.

The app board is Library `libfile_379c2419b28c81919d4e8220e256f447`, version 0, file `file_00000000d36081fdbbbbcb4bf8fc47b1`. It contains actual desktop/mobile viewport captures of six representative families, clearly labeled synthetic. Full captures and browser logs remain in `/workspace/scratch/clearsig-design-system`.

Updated landing board and real desktop/mobile scroll recordings are in `/workspace/scratch/clearsig-motion-review`. Their attempted batch Library replacement failed before upload (hosted tool discovery network error), including one retry. Existing Library motion versions remain version 0 and do not contain the final mobile polish. No uncertain or successful replacement is claimed. Checksums are in `/workspace/scratch/clearsig-design-system/artifact-checksums.json`.

## Remaining limits

- Human visual acceptance and publication of these local changes remain separate steps.
- Live provider/authentication, hardware/passkey prompts, financial submissions, canonical chain state, settlement evidence and venue execution require their existing configurations/capabilities and authorized integration tests. No financial or account operation was performed.
- Prior main's security workflow reported 23 frontend dependency advisories (14 moderate, 9 high). This visual-only pass makes no dependency remediation or fresh security-audit claim.
- Current external-wallet budget has only about 0.5 kB headroom. The existing provider-size constraint is unchanged; do not interpret a passing ratchet as completion of the smaller long-term targets.
