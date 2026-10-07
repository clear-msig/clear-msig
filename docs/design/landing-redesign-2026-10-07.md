# Landing redesign — 7 October 2026

## Why

The previous landing told the product's one idea ("sign intents, not hex") in
text and showed it as a static stack of cards. The new page shows it.

## Concept

Make the difference between signing bytes and signing a sentence visible and
touchable, in this order:

1. **Hero: "Same bytes. Two views."** (`ui/DecodeDevice.tsx`). A wallet
   prompt starts as the raw bytes a blind-signing wallet shows; a lime scan
   line wipes down and reveals the readable ClearSig document. The hex is the
   real UTF-8 encoding of that document (`domain/approvalDocument.ts`, with a
   round-trip test), so the claim is literally true. Buttons hold either view.
2. **Approval lab** (`ui/ApprovalLab.tsx`). The approval screen as a local
   demo: approve as teammates and watch the threshold meter fill; switch on a
   look-alike address and the differing address groups are highlighted. It
   mirrors the real review screen (amount, saved-contact / first-time /
   look-alike chip, before → after vault balance, deadline).
3. **How it works**: the three existing chapters as cards.
4. **"Signing bytes is a leap of faith."**: a five-row comparison of signing
   raw bytes versus ClearSig, with the pre-alpha disclaimer directly under it.
5. Products, then a closing call to action.

## What is illustrative

The 5 SOL request, "Operations" wallet, addresses, balances, limits and
members are examples. Nothing calls a wallet, an RPC or the network, and the
page says so ("Illustrative example. No transaction or signature.", "Local
demonstration."). Claims in the comparison table restate the README and
`docs/product-implementation-status.md`; the page keeps the pre-alpha
statement (devnet, not audited, single mock Ika signer).

## Motion, accessibility, no-JavaScript

- The decode sequence is pure CSS. With no JavaScript it plays once and ends
  readable. Under `prefers-reduced-motion` it is not animated and starts
  readable; the buttons still switch views.
- Everything below the fold stays visible without JavaScript; reveals are the
  existing `LandingReveal` progressive enhancement.
- Controls are at least 44px, have visible focus, and use real buttons,
  checkbox and table semantics. The comparison table stacks into labelled
  cards under 720px.
- The page is a server component; only the device, the lab and the existing
  marquee and reveal wrappers ship client code.

## Visual language

Obsidian and lime (`#ccff00`), as decided in `calm-interface.md`. New depth
comes from a soft lime bloom, a faint grid that fades out, larger type with
tighter tracking, and a floating glass header. Lime stays an accent: the
headline emphasis, primary actions, and status.

## Contracts kept

`landingExperience.test.ts` and `publicNavigation.test.ts` still pass: one
`<h1>`, the readable copy in server HTML, at least ten reveal wrappers, the
`#how-it-works` and `#products` anchors, the network list and disclosures,
and the neutral `#131316` panel surface.

## Not verified

Rendered at 1440px and 390px in Chromium only; no Safari, Firefox or real
phone. The interactions were exercised in Chromium (raw view, approvals,
look-alike toggle). No performance or conversion measurement was made.
