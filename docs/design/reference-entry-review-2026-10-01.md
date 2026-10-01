# ClearSig public entry review — October 1, 2026

This focused review builds on local commit `651cb24c`. It changes the public
landing introduction, not authenticated signing or transaction review screens.
Original obsidian/lime colors and all core/security changes are retained. No
source push, deployment, account operation or transaction was performed.

## Reference inspection and resulting composition

Both original JPEGs were extracted read-only from verified review commit
`763c169e1b852e07c111efe9846f0d73ef405700` and visually inspected. Git blob hashes:
`54b9bb2329545a6ec3f6c5ab9cb9970da089ffa5` and
`17bd8260a660ac4fd9eb555216c0933dc36eff58`. Earlier Library transfers could not
materialize them; the Git transfer provided exact original bytes.

The references use one large staged object, layered physical edges, a short
expressive headline and a decisive action. ClearSig translates those mechanics
into a front-facing example transfer, with policy and owner layers behind it.
No unrelated imagery, new login methods or claimed capabilities were copied.
Mobile places the illustration first, then a two-line headline and full-width
54px action. Desktop uses editorial text beside the larger product illustration.
The figure is explicitly illustrative; no transaction or signature occurs.

The existing interactive approval example and gradual explanatory chapters
remain below the introduction. The top navigation links to the existing sign-in
route; Explore ClearSig links to the existing product chooser. No auth provider
or sign-in behavior was changed. No critical actionable transaction information
was hidden, collapsed or altered: this is a marketing-only composition. Future
transaction UI work must preserve inspectable destination, amount, network,
permissions, fee/unknown estimates, risk and approval threshold.

One short entrance settles into a static illustration. Reduced motion disables
it. There is no automatic carousel, hover-only information or scroll locking.
The original progressive reveal component remains responsible only for lower
marketing chapters; no-JS content stays visible.

## Actual rendering and scope

The full app correctly presents its existing configuration error in this
executor because NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is absent. Final review
images therefore use the actual landing component, CSS and global styles in the
existing separate provider-free component harness. External requests were
blocked. No production auth bypass was introduced. The board explicitly states
this scope; it does not show live authenticated integration.

The final first-view PNGs cover 1440×960, 390×844 and 320×844 at 2× capture scale.
The combined board is 2480×1230, Library item
`libfile_3034e2e1dd988191b7104f329446d9e3`, version 0, file
`file_000000008d548210ae0bb105188d714a`. SHA256:
`30acf5359082de5f39415bef5456bc41e3010848572949e71a10ff9dc9c26252`.

Visual iteration corrected the demo caption overlapping the card shadow on
compact mobile, replaced a missing-font arrow glyph with SVG, and increased
small status text. The final caption clears the card at all reviewed widths.
The headline and main action fit together in each stated viewport. There is no
horizontal overflow or browser page error in the isolated captures.

## Validation

- `npm run verify`, with real local Redis integration enabled: 179 test files,
  1,132 tests and 14 script tests passed, including architecture/intent/metadata,
  lint and TypeScript checks. The final follow-up adjustments were CSS spacing,
  status text sizing and a decorative SVG; production build covers final source.
- Browser flows passed at 320/390/1440 with reduced motion, 390 without JS and
  390 with motion: skip-link keyboard navigation, correct action destinations,
  native disclosure, anchor back/forward, repeated demo/reset clicks where JS
  is available, clear illustration labeling and no horizontal overflow.
- Full-page images were also captured locally; no claim of full authenticated
  app coverage is made. Existing transaction and agent security paths were not
  changed. Root Rust/SBF source remains unchanged.
- Final production build passed (50 static pages). The secured-SDK bundle gate
  remains failing at unchanged peaks: largest chunk 535.7/506 kB gzip, standard
  authenticated route 1009.0/971, external runtime 1137.9/1100, legacy Turnkey
  998.8/954. No budgets or dependencies were relaxed.

This is one review direction, ready for pixel review before broader propagation.
The pending trading execution-mode decision remains unanswered and untouched.
