# Landing refinements — 7 October 2026

Base: `a4ba3bce7a40bedfab3d4749f63e86053f309503`, verified against GitHub
`main` before editing. Local working tree was clean. No AGENTS.md applies in
this checkout; `/workspace/.agents` is empty and no `.agents/skills` exists.
Read CONTRIBUTING.md and the existing landing review. This is a local-only
creative pass; no push or deployment is authorized or performed.

## Implemented

- The approval HUD is contextual: hidden and removed from keyboard traversal
  outside the story, restored on forward/reverse entry. It remains available
  for chapter jumps and skip while the story is active. Without JavaScript,
  navigation is ordinary document flow. Story padding and scroll clearance
  keep controls usable above the HUD.
- The three compact product cards become alternating illustrated scenes with
  original inline SVG diagrams for shared context, recovery planning and
  bounded authority. The scenes use native page flow and existing progressive
  reveals; there are no extra pinned intervals or empty scroll delays.
- Giant C, dark/lime identity, product URLs, devnet disclosures, recovery
  pre-alpha and gated execution language are preserved. No product behavior,
  signing, policy, auth, dependencies, venues or trading settings changed.
- Sigi uses the exact verified transparent PNG: a 112px desktop perch beside
  the C, a 100px static in-flow mobile appearance, optional welcome/tour, and a
  100px return beside resources. Quiet/dismiss choices persist for the browser
  session; storage failure cannot gate the landing. Keyboard focus moves to the
  requested chapter or back to a meaningful heading/CTA when controls disappear.
  The guide reuses existing explanatory copy and never reacts to approvals.
- Browser regression now directly checks the original fresh-hero overlap,
  HUD absence at products/resources and after reversing to the hero, plus
  existing menu, keyboard, story controls, deep-link and refresh behavior.
  Stable scene selectors work in both development and production builds.

## Exact scope from the verified main baseline

1. `apps/web/src/features/landing/ui/ApprovalStory.tsx`
2. `apps/web/src/features/landing/ui/ApprovalStory.module.css`
3. `apps/web/src/features/landing/routes/LandingPage.tsx`
4. `apps/web/src/features/landing/routes/LandingPage.module.css`
5. `apps/web/src/features/landing/ui/ProductScene.tsx` (new)
6. `apps/web/scripts/browser-regressions/landingStory.cjs`
7. `apps/web/src/features/landing/ui/SigiGuide.tsx` (new)
8. `apps/web/src/features/landing/ui/SigiGuide.module.css` (new)
9. `apps/web/src/features/landing/ui/SignatureStage.tsx`
10. `apps/web/src/features/landing/ui/LandingResources.tsx`
11. `apps/web/public/brand/sigi.png` (new)
12. `apps/web/scripts/browser-regressions/sigiGuide.cjs` (new)
13. This review record.

The independent HUD/illustration change is local commit
`1ea22a0e5bd716e9bca84a53cab8d0580be337dc`. Sigi is a subsequent local commit.

## Exact Sigi asset recovery

The original binary blob is `81d693c5a355d26f50d6a1b681b0178a1ca02ef5`.
The official GitHub `fetch_blob` tool was called for that exact SHA/repository
and failed with `UnicodeDecodeError: 'utf-8' codec can't decode byte 0x89 in
position 0: invalid start byte`. The generic Git read also rejected binary text;
local `gh api` returned `Forbidden`; the supported Library download failed.
Those initial failures are resolved by a newly supplied, authorized text blob,
not by bypassing the shell denial.

The parent staged the SAME PNG as ASCII base64 in unreferenced blob
`9999ba12383efccc57edfb028149654dc9ff7814`. Official `fetch_blob` succeeded,
returning the ASCII text in `structuredContent.content`. It was decoded exactly
once, with strict base64 validation, then checked before inspecting its pixels:

- 53,138 bytes; 217×266; RGBA PNG; alpha extrema 0–255.
- SHA-256: `e419154b60e0ec64aaa7d7c3c895c5a83d6ca7310b28070579ba819a8da383cf`.
- Pixels inspected: the approved near-black owl, sage-rimmed eyes, green feet and
  beak, and white C belly. No regenerated anatomy, recoloring or image edits.
- Original bytes copied to `public/brand/sigi.png`; served directly without image
  optimization. Browser checks verify the served length, hash and dimensions.
- No branch/ref was changed by asset staging. No push or deployment occurred.

## Validation

- `npm ci --ignore-scripts` restored the committed lockfile (the workspace's
  preinstalled Next version was stale). No manifests or lockfiles changed.
- Aggregate `npm run verify`: 249 suites / 1,948 tests, including all six real
  Redis integration cases, plus 27 script tests; lint, TypeScript, metadata,
  architecture and intent/signing registry checks passed.
- Redis was installed under the external review workspace with its required
  shared library, then configured via CLEARSIG_TEST_REDIS_BIN/CLI. The initial
  attempt failed on missing liblzf; the complete aggregate rerun passed.
- Development Chromium matrix: all 11 original configurations passed.
- `bash scripts/check-secrets.sh` and `git diff --check` passed.
- Production `npm run build:webpack` passed with the existing configuration.
  `npm run check:bundles` passed without changing gates: external-wallet profile
  1123.5/1124 kB; legacy Turnkey 979.4/991 kB.
- All six Sigi production scenarios passed: 1180×757, 1000×720, 390×844,
  320×740, desktop reduced motion and mobile no JavaScript. They check served
  PNG bytes/hash/dimensions, 100–180px sizing, static mobile/reduced-motion
  presentation, keyboard tour entry, forward/reverse guide steps, demo control
  clearance, ending the guide, quiet/dismiss persistence, resource return and
  focus restoration. The guided owner CTA also clears the HUD without extra
  scrolling at 1000×720 (bottom 638.77px; HUD top 642px).
- Nine production axe WCAG 2 A/AA + 2.1 AA scans passed with zero violations:
  welcome, guided page and menu at 1180, 390 and 320px. Automated scans do not
  replace manual assistive-device testing.
- All 12 final production Chromium configurations passed: 1440×900,
  1280×720, 1180×757, 1000×720, 1180×650, 390×844, 320×740, 768×1024,
  desktop/mobile reduced motion, and desktop/320px no JavaScript. Checks cover
  fresh hero clearance, forward/reverse story navigation, policy/demo controls,
  menu focus loop/Escape/history/scroll lock, skip, anchors, refresh, mobile
  control/footer clearance, no overflow and no page errors.
- Desktop and mobile production captures are collected in
  `ClearSig-landing-refinements-review.pdf`, updated to include the verified Sigi
  implementation and supersede the earlier blocked-asset report. Screenshots, logs and machine-readable results are retained in
  `/workspace/clearsig-review` outside the source checkout.

The local landing runtime uses a clearly synthetic public Dynamic environment
ID and a loopback-only backend URL; browser tests block all non-local requests.
Production validation initially exposed the missing required backend setting;
the build was repeated with both local test settings. A prior mixed dev/build
cache was moved aside after stopping an orphaned preview child process. This verifies the landing
flow, not authenticated product flows. No live wallet connects, signatures,
transactions or provider credentials are involved. No Rust/SBF tests or
separate dependency-remediation work were run for this frontend-only change.

## Bounded mobile resources polish

Below 651px, the resource note now stacks its text beneath the original 100px
owl, with the 44px dismiss target in the upper-right grid cell. Tablet/desktop
stay side by side. The label remains one line and the sentence is two lines at
320, 390 and 768px; measured copy widths are 272, 342 and 430px respectively.

After this CSS-only change, production build (including lint/types), unchanged
bundle gates, `git diff --check`, targeted 320/390/768 browser checks and 320px
no-JavaScript checks passed. Three new axe WCAG 2 A/AA + 2.1 AA scans found zero
violations. Checks covered original owl size, full-width phone copy, 44px control
clearance, keyboard dismissal/focus restoration, no overflow and no page errors.
The previous full aggregate and 18 interaction scenarios remain documented above;
they were not unnecessarily repeated for this layout-only polish.

Motion is whole-image only: desktop Sigi begins perched beside the C, then shares
its scroll progress for up to 16px translation, 10% scaling down, and fading.
There is no separate peek-in, blink, eye, wing or pointing animation. Mobile and
reduced-motion Sigi remain static in their respective layouts.

The same Library PDF is updated with narrow resource captures, and
`ClearSig-Sigi-welcome-desktop-mobile.png` provides a compact welcome comparison.
