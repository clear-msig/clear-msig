# ClearSig calm-interface pass

## Direction

Keep ClearSig recognizable while making the interface easier to read for longer
periods. Use a neutral canvas, one clear decision at a time, modest depth, and a
muted sage accent. Color emphasizes actions and status; it is not the background
for an entire receipt or permission diagram.

The user-supplied mobile reference showed a large neon-green signing receipt and
repeated oversized green badges. The landing now uses neutral receipt surfaces,
smaller contextual details, and clear vertical spacing instead.

## Design references

- [Apple: Color](https://developer.apple.com/design/human-interface-guidelines/color):
  use color consistently and sparingly, retain contrast in both appearances, and
  pair status colors with text or icons
- [Apple: Layout](https://developer.apple.com/design/human-interface-guidelines/layout):
  establish importance through order, alignment, and grouping
- [Apple: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles):
  keep necessary information close, use familiar controls, and make recovery clear
- [OpenAI: Design guidelines](https://openai.com/brand/): consistent proportions,
  readable typography, and deliberate open space informed this interpretation

These are principles, not a copy of another company's identity. ClearSig's mark,
name, product structure, and readable-approval concept remain its own.

## Applied changes

- Dark accent: `#a3be8c`; light accent: `#47663c`. Primary-button text keeps AA
  contrast in both themes. Shared app tokens and legacy onboarding/public accent
  treatments use the same quieter color family
- Alpha-compatible RGB token channels ensure Tailwind actually emits tinted
  surfaces, translucent navigation and border/text opacity variants
- Browser chrome and manifest theme color use neutral `#0c0c0c`
- Landing: concise hero, finite network list, three-step overview, readable
  neutral receipt, compact agent boundaries and recovery plan, simple footer
- Removed repeated ticker/carousel content and the unused animated recovery
  mockup. Navigation and calls to action remain available without JavaScript
- Scroll reveals enhance only below-the-fold landing sections. Server HTML is
  visible by default; missing IntersectionObserver, reduced-motion, print, and
  keyboard focus all keep content readable. App controls are never scroll-hidden
- Shared search and notifications use adaptive surfaces/text; dropdowns and
  dialogs handle focus; form primitives associate labels, help and errors with
  controls instead of relying on color alone

## Verification

Automated regression tests cover server/no-JavaScript rendering, reveal fallback
contracts, theme contrast, field accessibility, modal focus, and the underlying
send/recovery/recurring lifecycle fixes.

The deployed desktop landing and product chooser and the supplied mobile image
were visually inspected. These are baseline evidence, not screenshots of this
working tree. An isolated local Next+Playwright session was explicitly authorized
and reached the application at HTTP 200, but this execution runtime denied the
Unix socket needed to launch Chromium, including after scoped tool escalation.
No local screenshot was produced; desktop/mobile/light/reduced-motion visual
acceptance remains a required check in a browser-capable environment before
release. No wallet connection, live transaction, push, or deployment was used.
