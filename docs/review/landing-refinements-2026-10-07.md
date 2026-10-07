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
- Browser regression now directly checks the original fresh-hero overlap,
  HUD absence at products/resources and after reversing to the hero, plus
  existing menu, keyboard, story controls, deep-link and refresh behavior.
  Stable scene selectors work in both development and production builds.

## Exact scope

1. `apps/web/src/features/landing/ui/ApprovalStory.tsx`
2. `apps/web/src/features/landing/ui/ApprovalStory.module.css`
3. `apps/web/src/features/landing/routes/LandingPage.tsx`
4. `apps/web/src/features/landing/routes/LandingPage.module.css`
5. `apps/web/src/features/landing/ui/ProductScene.tsx` (new)
6. `apps/web/scripts/browser-regressions/landingStory.cjs`
7. This review record.

## Sigi blocked — no substitute

The requested blob is `81d693c5a355d26f50d6a1b681b0178a1ca02ef5`.
Expected PNG: 53,138 bytes, 217×266, SHA-256
`e419154b60e0ec64aaa7d7c3c895c5a83d6ca7310b28070579ba819a8da383cf`.

- GitHub `fetch_blob`: `UnicodeDecodeError: 'utf-8' codec can't decode byte
  0x89 in position 0: invalid start byte`.
- Supported generic Git-object fetch: `HTTPError: 400: GitHub Fetch only
  accepts UTF-8 text. (Response: None)`.
- Local `git cat-file`: object unavailable in this checkout.
- Local `gh api` for the exact blob: `Forbidden`. No alternate transport was
  attempted around that denial.
- The separately authorized Library copy
  `libfile_39439909140481918d3ed413cfefad65` resolved as
  `sigi-original-transparent.png`, 53,138 bytes, version 0. The current supported
  Library transfer helper returned `library file transfer failed: download failed`.

No image bytes were retrieved, so the hash and pixels could not be verified.
No mascot asset, placeholder, regenerated owl or incomplete mascot UI was added.
Sigi integration remains blocked until the exact file is available through an
allowed download or local attachment.

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
- Six production axe WCAG 2 A/AA + 2.1 AA scans passed with zero violations:
  page and menu at 1180, 390 and 320px. Automated scans do not replace manual
  assistive-device testing.
- All 12 final production Chromium configurations passed: 1440×900,
  1280×720, 1180×757, 1000×720, 1180×650, 390×844, 320×740, 768×1024,
  desktop/mobile reduced motion, and desktop/320px no JavaScript. Checks cover
  fresh hero clearance, forward/reverse story navigation, policy/demo controls,
  menu focus loop/Escape/history/scroll lock, skip, anchors, refresh, mobile
  control/footer clearance, no overflow and no page errors.
- Desktop and mobile production captures are collected in
  `ClearSig-landing-refinements-review.pdf`; the PDF explicitly marks Sigi as
  blocked. Screenshots, logs and machine-readable results are retained in
  `/workspace/clearsig-review` outside the source checkout.

The local landing runtime uses a clearly synthetic public Dynamic environment
ID and a loopback-only backend URL; browser tests block all non-local requests.
Production validation initially exposed the missing required backend setting;
the build was repeated with both local test settings. A prior mixed dev/build
cache was moved aside after stopping an orphaned preview child process. This verifies the landing
flow, not authenticated product flows. No live wallet connects, signatures,
transactions or provider credentials are involved. No Rust/SBF tests or
separate dependency-remediation work were run for this frontend-only change.
