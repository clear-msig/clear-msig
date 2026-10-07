# Landing experience review — 7 October 2026

Starting commit: `0693cd77e71cb5f4b3c33856c779d542a76d2971`.
Scope: the five landing-experience mechanisms. Original black/lime palette,
sculptural ClearSig identity, auth and financial behavior are preserved.

## Acceptance evidence

| Requested mechanism | Implementation | Current verification |
| --- | --- | --- |
| Connected staged story | Native scroll through request, rules and owners, with a bounded sticky workspace at ≥1000×800; shorter desktops use normal flow | Forward/reverse chapter traversal and sticky position passed; normal-flow mobile/tablet/reduced-motion/no-JS fallbacks passed |
| Evolving shared scene | The same 5 SOL request is transformed and layered with policy and owner surfaces; explicit local 12 SOL block and second-approval/reset examples | Scroll does not approve. Policy failure disables approval; restore/reset/repeated actions passed. CSS perspective/transforms, not a claimed WebGL engine |
| Progress, chapter jumps and skip | Persistent labelled navigation on every width, current chapter, progress bar and skip-to-products | Direct jumps, reverse progress, deep links, refresh and skip passed, including 320px |
| Expanded navigation | Native modal dialog, grouped real destinations, keyboard loop, Escape, restored focus, background scroll lock and history handling | Desktop/mobile keyboard, Back/Forward and chapter selection passed; axe menu scans passed |
| Supporting content | Three product explanations with local HTML diagrams, native expandable questions, genuine repository resources and grouped footer | Repository documents exist; destination inventory checked; readiness disclosures retained; no invented social links, videos, metrics or testimonials |

The early visual checkpoint is `clearsig-landing-mechanisms-checkpoint.png`,
Library `libfile_537b54068e888191b6a394eb74b39e6e`, version 0. It shows desktop
request/rules/owners/menu and mobile normal flow. This is an intermediate visual
review artifact, not production deployment proof.

## Verification

- Eight Chromium configurations passed on the final production build (seven
  in the main run, then the no-JavaScript case after correcting test polling): 1440×900 and 1280×720 desktop,
  390×844 and 320×740 mobile, 768×1024 tablet, desktop/mobile reduced motion,
  and desktop JavaScript disabled.
- No page errors or horizontal overflow in the matrix.
- Six axe WCAG 2 A/AA + 2.1 AA scans passed with zero violations: story and
  menu at 1440, 390 and 320px. Automated scans do not replace assistive-device testing.
- Aggregate `npm run verify` passed: 249 suites / 1,948 tests, including six
  real local Redis integration cases, plus 27 script tests. Lint, TypeScript,
  metadata, architecture and signing registry checks passed.
- Final production build and unchanged bundle gate passed: external-wallet profile
  1123.5/1124 kB; legacy Turnkey 979.4/991 kB. No limits were relaxed.
- Parent visual critique of the final evidence package remains pending. No publication yet.
- A direct production-browser recording covers forward/reverse traversal, skip,
  grouped menu, keyboard movement and Escape. It is sampled capture evidence,
  not a frame-rate benchmark. Supporting screenshots show resources/footer and
  mobile controls. Links and disclosure content were checked separately from pixels.

Reproduce browser checks with a local landing server and installed Playwright:
`STORY_URL=http://127.0.0.1:3107 node scripts/browser-regressions/landingStory.cjs`.
`CHROMIUM_PATH` selects Chromium and `STORY_REPORT` selects the JSON report.
`STORY_CASE` optionally selects one zero-based scenario for a focused rerun.
The harness waits for settled native scrolling before asserting clearance.
All non-local browser requests are blocked in this interaction matrix. Its
approval example is local synthetic state, not live auth/wallet/payment testing.

## Scope isolation

Two unintended venue edits (allowlist validation and its tests) were removed
from the working tree and saved only to
`/workspace/scratch/venue-out-of-scope-2026-10-07.patch`; the unintended report
was moved to scratch. They were never committed or pushed and are excluded
from this landing deliverable. Two pre-existing untracked venue-policy reports
remain untouched and must not be included in the landing commit.

No Rust/SBF, trading, payment, authentication, dependency or security-policy
changes are included. Previously known security-CI dependency findings remain
outside this landing scope; a frontend build does not clear them. External
product routes may require configured providers; link correctness is not a
claim that authenticated production flows were tested.
