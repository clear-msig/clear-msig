# clear-msig: Colosseum Submission Plan

Research compiled 2026-04-29. Sources verified or flagged where uncertain.

---

## Part 1 — Colosseum Hackathon (Solana Frontier)

### Cycle
- **Solana Frontier Hackathon** — April 6 to May 11, 2026 (online).
- 11th Solana Foundation hackathon, 4th run by Colosseum.
- Followed by Colosseum's accelerator program for selected winners.
- Source: [Colosseum Frontier](https://colosseum.com/frontier).

### Prize Pool (verified for Frontier 2026)
| Prize | Amount |
|---|---|
| Grand Champion | $30,000 |
| Public Goods Award | $10,000 |
| University Award | $10,000 |
| 20 Standout Teams | $10,000 each ($200,000 total) |
| Accelerator (post-event) | $250,000 pre-seed for selected teams + mentorship |

> Note: Track-specific prizes ($25k each) appeared in Cypherpunk + Breakout
> announcements; the Frontier landing page only lists the awards above. Track
> structure for Frontier is **not public on the landing page** — flag for
> user to confirm via the Arena portal at https://arena.colosseum.org once
> registered.

### Submission requirements
1. **Pitch video, ≤ 3 min** — startup-pitch tone, *not* a product demo. Must cover team background, the problem, target users, validation, vision.
2. **Technical demo video, 2–3 min** — implementation focus: tech stack, Solana integration, design decisions, gameplay/walkthrough/architecture visuals.
3. **GitHub repo** — public OR private with judge access granted to Colosseum.
4. **Project submission form** — product name, short description, team background, "anything critical to understanding the vision".
5. **Deployed URL** (implied, not always stated) — judges expect a live demo, even if devnet-only.

> Source: [Perfecting Your Hackathon Submission](https://blog.colosseum.com/perfecting-your-hackathon-submission/).

### Judging signals (what wins)
- **Real problem for real users.** Evidence: Twitter/Telegram conversations, actual adopters, traction numbers.
- **Solana integration depth.** Reasoning behind on-chain logic and architecture, not just "we used Anchor".
- **Market thinking.** TAM, why now, why this team. Public-goods entries still need adoption signals.
- **Adaptability of the team.** Judges (ecosystem leaders + founders) discount static slide-deck pitches; they reward iteration evidence.

### Past winners (the comparable bar)
**Cypherpunk (2025) — 9000+ participants, 1576 final projects**
- Grand Champion: **Unruggable** — Solana hardware wallet + companion app ($30k).
- Track winners: Capitola (prediction-market aggregator), Yumi (BNPL), Seer (tx debugger), Autonom (RWA oracle), MCPay (MCP+x402 payments), attn.markets (revenue tokenization). All $25k.
- Public Good: **Samui Wallet**.

**Breakout (2025) — 10,000+ participants, 1412 final projects**
- Grand Champion: **TapeDrive** — decentralized storage with rewards ($50k).
- Tracks: Trepa (sentiment prediction mobile), Vanish (privacy DeFi), Latinum (MCP payments), FluxRPC, Crypto Fantasy League, CargoBill, Decen Space, LootGo, IDL Space (public good).

> Sources: [Cypherpunk Winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/), [Breakout Winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-breakout-hackathon/).

### Patterns across winners
- Almost all had a **deployed product**, not a demo video alone.
- **Concrete problem statements**: "treasury teams sign blind hex blobs" maps cleanly to clear-msig's pitch.
- **Hardware-wallet integration** showed up twice in the top 5 (Unruggable, Samui). clear-msig's clear-signing × Ledger is exactly this lane.
- Multiple winners were **infrastructure for builders**, not consumer apps. Multisig sits in this lane.
- **Naming + visual identity** matters. "Unruggable", "TapeDrive", "Vanish" are memorable. "clear-msig" is descriptive but generic.

---

## Part 2 — "Super App" Benchmark

Treating "Super App" as "top-tier Solana consumer/infra dApp circa 2025–2026."

### Phantom
- **Onboarding**: seed phrase → biometric (mobile) or password (desktop) → token list → optional swap walk-through. Cold-to-funded in ~90 seconds.
- **Visual identity**: lavender/purple, generous whitespace, animated empty states, native-app-feeling transitions.
- **v1 surface**: portfolio, swap, NFT, staking, browser, Solana + EVM + Bitcoin via single seed.
- **Mobile**: native app first; web is secondary. Tab bar, biometric quick-unlock, in-app browser for dApps.
- **Quality signals**: every async action animates, every error has a recovery path, every empty state has a CTA. *No raw error messages ever surface.*

### Jupiter
- **Onboarding**: connect wallet → swap is the first thing visible → "Swap" button is dominant action above the fold. No tutorial.
- **Visual identity**: charcoal background, neon-green accents, terminal-like density without feeling cramped.
- **v1 surface**: swap, perps, limit orders, DCA, bridge, stake. All accessible from one nav.
- **Mobile**: web responsive, not a native app; performant.
- **Quality signals**: real-time route preview, slippage tooltips, route map visualization, optimistic UI updates.

### Sanctum (staking)
- **Onboarding**: connect wallet → see your SOL balance → "Stake" CTA → list of LSTs. Tutorial-free.
- **Visual identity**: warm cream background, hand-drawn-feeling icons, friendly playful copy.
- **v1 surface**: stake, swap LSTs, validator dashboard, infinity pool.
- **Mobile**: web responsive, decent.
- **Quality signals**: APY transparency, validator info inline, conversion previews live.

### Squads Protocol (clear-msig's direct comparable)
- **Onboarding**: connect wallet → "Create vault" or "Join vault" CTAs → step-through wallet setup with named slots for signers + threshold.
- **Visual identity**: clean white, navy accents, professional-finance feel (target audience = treasury teams).
- **v1 surface**: vaults, transactions, members, settings, **spending limits**, **roles & permissions** (Proposer/Approver/Executor), sub-accounts, address-book.
- **Mobile**: web responsive; recently launched a mobile app.
- **Quality signals**: 3 security audits (OtterSec, Neodyme, Trail of Bits), formal verification in progress, simulation-before-execution for every tx, named roles with permissions matrix.
- **Sources**: [Squads docs](https://docs.squads.so/main), [Solana Compass profile](https://solanacompass.com/projects/squads).

### What "Super App" patterns translate to clear-msig
1. **One dominant action above the fold** (Squads = Create vault; Phantom = Send/Receive). clear-msig should make "Create organization" or "Open my treasury" the single dominant CTA on /app/wallet, not split between MyOrganizationsCard + CreateWalletCard side-by-side.
2. **Animated transitions on every state change**, not just on initial load.
3. **Simulation/preview before commit** — Squads previews every tx before sending. clear-msig has SignablePreview but only for the human-readable byte string; doesn't simulate the *outcome* (e.g., "this will move 0.5 SOL from treasury to recipient and leave a balance of X").
4. **Roles, not just lists.** Squads has Proposer / Approver / Executor as distinct roles. clear-msig has proposers + approvers but no Executor role and no per-member permission flags.
5. **Address book / contacts.** Recurring recipients should be saveable.
6. **Audit + verification badges.** Squads displays "Audited by OtterSec, Neodyme, Trail of Bits" prominently. clear-msig has nothing equivalent yet.

---

## Part 3 — clear-msig Audit

### Repo state (as of HEAD `ac22523`)
Recent commits show a heavy iteration cycle today: minimalist header, onboarding walkthrough, dark theme, 4-tab wallet detail, CORS pin, validators, clear-signing context strip. Build is green, deployed on Vercel + Fly. No TODO/FIXME/console.log left in source.

### File-by-file findings

**`src/app/app/wallet/[name]/page.tsx` (921 lines)**
- Carrying tabs (Overview/Intents/Proposals/Activity) + 6 inline panel components + helper functions. **Refactor candidate** — extract panels to `src/components/wallet/panels/*.tsx`. (M)
- ChainBindingsPanel just got an inline bind action (good). But there's no progress indicator for the multi-step DKG flow which can take 10–30s on Ika devnet. Users see "Binding…" with no detail.
- IntentTablePanel: overflow-x-auto handled (good). No row-click navigation to a per-intent detail page (which doesn't exist). Compare to Squads where every transaction row drills to a detail page.
- RecentProposalsPanel: only top 5; no pagination, no filtering by status (active/approved/executed/cancelled).

**`src/components/intents/IntentCard.tsx` (887 lines)**
- Single mega-component that handles add/update/remove modes. Splitting into 3 named components would improve readability. (M)
- AddOrUpdatePanel form has many params validated implicitly (button disabled until valid). **No inline error messages** — user can't tell why submit is disabled.
- TEMPLATE_CATALOG dropdown — useful, but the templates aren't explained beyond their name. A judge would expect each template to have a 1-sentence explanation of what it produces. (S)

**`src/components/proposals/ProposalCard.tsx` (494 lines)**
- Now takes `walletName` prop (good). IntentPicker auto-selects the first available intent (good).
- The clear-signing context strip just landed — judges will notice this. **This is your headline UX feature for Colosseum.** Make sure the demo video lingers on it.
- No "save as draft" flow if a user fills params but isn't ready to sign.
- No per-param hints beyond a placeholder.

**`src/app/app/proposals/[proposal]/page.tsx` (884 lines)**
- Has approve / cancel / execute / cleanup flows. Clean.
- Live ApprovalBitmap with realtime subscription is a strong feature — call it out in the technical demo video. *"Watch other signers approve in real time."*
- No "share this proposal" link UI — users would naturally want to send proposal URLs to other signers; would help adoption.

**`src/components/proposals/SignablePreview.tsx` (236 lines)**
- The new `context` chip strip ("Action / Wallet / Chain / Threshold") is excellent. **This is the differentiator vs. Squads.** Hammer it in the pitch.
- The hex pane is dimmed and copyable — good. Could add a *"this is what your Ledger will show"* annotation arrow pointing to the human-readable pane in a stylized way for the demo.

**`src/components/wallet/CreateWalletCard.tsx` (446 lines)**
- Multi-step (3-step) wizard. Good UX for first-time creation.
- Sends invite emails after wallet create — nice touch.
- No "save and finish later" — if the user fills step 1+2, refreshes, they lose state.
- Threshold validation has clear messages (good).

**`src/components/wallet/MyOrganizationsCard.tsx` (137 lines)**
- Solid loading/empty/error states. Good.
- Cards link to `/app/wallet/[name]` — but if `wallet_name` is missing, link goes to `#`. Should fall back to a link by PDA + a "name unavailable" helper.

**`src/components/onboarding/OnboardingWalkthrough.tsx` (158 lines)**
- 3 slides. Auto-dismiss on connect. Escape closes. Decent.
- **Missing**: a visual diagram of "you sign once → multisig → Ika dWallet → 5 chains". Words aren't enough; a judge watching a 3-min pitch needs to see the architecture in 1 frame.
- No re-trigger from the landing page when not connected (only from menu drawer, which is gated on connection).

**`backend-api/src/main.rs` (1890 lines)**
- New validators landed: ensure_wallet_name, ensure_chain, ensure_base58. Solid.
- CORS pin via `CLEAR_MSIG_ALLOWED_ORIGIN` is now live in prod.
- Rate limiter (30 req / 60s per pubkey) on pre-signed writes. Good.
- The whole backend is one file at ~2k lines. Splitting into modules (handlers/, validators/, runner/) would help maintainability + judges who read code. (M)

### Cross-cutting observations
- **Accessibility is sparse**: 37 aria-* refs across the whole frontend, 3 focus-related rules. Tab navigation through modals leaks. (S to start, L to finish)
- **Loading/empty/error coverage** is reasonable (~21 distinct usages) — better than most hackathon submissions.
- **Explorer links** appear only 5 times across the frontend. Every tx hash should link out by default. (S)
- **No tx simulation** before submitting (Squads does this).
- **No address book / contacts** — recurring recipients require re-typing 44-char base58 every time.
- **No audit / security badges** displayed on the site. Even "Audited internally, smart-contract code open-source on GitHub" + a link to the program would be a credibility bump.
- **No analytics** — judges can't see usage; you can't prove "real users".

---

## Part 4 — Prioritised Roadmap

Effort key: **S** ≤ 2 hrs, **M** ≤ 1 day, **L** > 1 day. Order: impact / effort.

### A. Must-ship before submission (correctness gaps that would disqualify or embarrass)

| # | Item | Files | Effort | Why it matters for Colosseum |
|---|---|---|---|---|
| A1 | **Reset devnet judge state** — fund a fresh payer keypair, create a demo "treasury" wallet pre-bound to all 5 chains, seed 1 approved intent + 1 active proposal so judges see a populated app. | `scripts/cli-demo-bootstrap.sh` extension; new `scripts/seed-judge-state.sh`. | M | Empty UI = empty pitch. Judges open the live URL; first impression matters. |
| A2 | **Demo video — pitch (≤ 3 min)** following Colosseum's structure: team → problem (blind signing on Ledger) → users (DAO treasuries, Solana orgs) → solution → vision. | Out-of-repo. | M | Mandatory submission artifact. |
| A3 | **Demo video — technical (2–3 min)** showing: clear-signing context strip → multisig approval → Ika dWallet 2PC-MPC → BTC/ETH tx broadcast. Lingers on the SignablePreview pane. | Out-of-repo. | M | Mandatory submission artifact; judges assess Solana integration here. |
| A4 | **Fix all stale program-ID references** in `frontend/src/lib/chain/client.ts`, `backend-api/src/main.rs`, `IMPLEMENTATION_STATUS.md`, `DEVELOPMENT.md` (most done — verify). | 4 files. | S | A judge clones the repo, sees inconsistent IDs, loses trust. |
| A5 | **Smoke-test the deployed end-to-end flow** in a fresh incognito browser: onboarding → connect → create org → bind chain → add intent → propose → approve x2 → execute → broadcast → activity tab shows tx. | Manual. | S | If anything breaks at this step, the demo video is impossible. |
| A6 | **Pre-alpha disclaimer banner** on the deployed site (already exists, verify visible to judges). | `PreAlphaBanner.tsx`. | S | Sets expectations; protects from "this lost my funds" complaints. |

### B. Should-ship for credibility (judges expect these from a serious project)

| # | Item | Files | Effort | Why |
|---|---|---|---|---|
| B1 | **Multi-chain visualisation in onboarding.** Replace slide 2's text with an animated diagram: signer → on-chain policy → Ika dWallet → SOL/ETH/BTC/ZEC chips lighting up. Same data the SystemCircuitSection already renders on landing — port it. | `OnboardingWalkthrough.tsx`, reuse `SystemCircuitSection`. | M | Judges glance at the onboarding once. The diagram does in 5 seconds what 3 paragraphs can't. |
| B2 | **Simulation-before-sign** for proposals (mock or real). Show "if approved + executed, this will: transfer 0.5 SOL from <wallet> to <recipient>; net change: -0.5 SOL". | New panel above SignablePreview in `ProposalCard.tsx`. | M | Squads has this. Judges familiar with Squads will look for it. Differentiates from "blind" multisigs. |
| B3 | **Per-tx Solana explorer links** everywhere a hash appears — broadcast txs, ika_sign txs, intent-creation txs. Currently 5 places, should be ~15. | Various components. | S | Trust signal; lets judges verify on-chain. |
| B4 | **"Share this proposal" deep-link** with copy button on `/app/proposals/[proposal]` page. | `proposals/[proposal]/page.tsx`. | S | Real treasuries operate by sharing URLs in Slack/Telegram. Without it, the multisig story falls apart. |
| B5 | **Inline form validation messages.** Replace "submit button disabled, no reason" with "Threshold must be ≤ approver count" under each input. | `CreateWalletCard.tsx`, `IntentCard.tsx`, `ProposalCard.tsx`. | M | Standard expectation. Judges marking down apps that go silent. |
| B6 | **Audit + open-source badge strip** on landing footer: "Quasar-built · Open source · Pre-alpha · Devnet only" with links to GitHub + DEPLOYMENTS.md. | `LandingFooter.tsx`. | S | Trust signal. Squads displays its 3 audits prominently. |
| B7 | **Address book / saved recipients.** Local-storage-backed list of named addresses; appears as autocomplete in proposal create. | New `src/lib/addressBook.ts` + integration. | M | Real treasuries use the same recipients repeatedly. |
| B8 | **Project name + logo refinement.** "clear-msig" is descriptive but unmemorable. Workshop a name (same way "Squads" did). At minimum, a better wordmark + favicon. | Brand work, `public/`. | M | Pattern across winners: memorable identity. |
| B9 | **Live status panel for Ika DKG** — when binding a chain, show actual progress ("Round 1 of 4", "Network reachable", "DKG complete"). | `wallet/[name]/page.tsx` ChainBindingsPanel. | M | Otherwise users stare at "Binding…" for 30s and assume it's hung. |
| B10 | **README quickstart** updated for the deployed product (not just CLI). One-paragraph "what is this", live URL, video, "how to run a demo". | `README.md`. | S | First thing judges open after the submission form. |

### C. Nice-to-have polish (delta to "Super App")

| # | Item | Files | Effort | Why |
|---|---|---|---|---|
| C1 | **Refactor `wallet/[name]/page.tsx`** (921 lines) into `panels/*.tsx`. Same for IntentCard's mode panels. | Multiple. | M | Code-readability for judges who open the repo. |
| C2 | **Modularize `backend-api/src/main.rs`** (1890 lines) into `handlers/`, `validators/`, `runner/`. | Multiple. | M | Same. |
| C3 | **Focus traps + keyboard navigation in modals** (onboarding, menu drawer). Add `focus-trap-react` (12kB) or hand-roll. | `OnboardingWalkthrough.tsx`, `HeaderBar.tsx`. | S | Accessibility. |
| C4 | **Skeleton loading for tabs**, not just text "loading…". | Various panels. | S | Standard premium feel. |
| C5 | **Pagination + filters on Activity tab.** Currently shows last 25 unconditionally. | `TxHistoryPanel.tsx`. | M | Approaches Squads' usability. |
| C6 | **Roles permission matrix.** Today: proposers + approvers as flat lists. Add: per-member toggle (can_propose, can_approve, can_execute), Squads-style. Requires on-chain change → defer. | Cross-cutting; on-chain. | L | Big feature; only if time allows. |
| C7 | **Spending limits.** A second on-chain feature for tighter Squads parity. | Cross-cutting; on-chain. | L | Big feature; only if time allows. |
| C8 | **Mobile native shell.** PWA install banner + tap-friendly bottom nav. | `frontend/src/app/manifest.ts`, layout tweaks. | M | Solana Mobile track is real prize money. |
| C9 | **Analytics (Plausible / Posthog)** so the team can show "X users tried it" in the pitch. | `frontend/src/app/layout.tsx`. | S | Material for the pitch's "traction" slide. |
| C10 | **Twitter / Telegram presence**: a thread, demo gif, ~50 followers. | Out-of-repo. | M | Judges weight visible community; the rubric says so. |

### Recommended day-by-day plan (2-week sprint to submission)

> Assuming submission deadline ≈ May 11.

- **Days 1–2**: A4, A6, B3, B4, B6, B10. Cleanup + trust signals.
- **Days 3–4**: A1 (judge state), B5 (form validation), B9 (DKG progress).
- **Days 5–6**: B1 (onboarding diagram), B2 (simulation), B7 (address book).
- **Days 7–8**: C1 + C2 (refactors), C3 (focus traps), C4 (skeletons).
- **Days 9–10**: B8 (brand), C8 (PWA), C9 (analytics), C10 (Twitter thread).
- **Days 11–12**: Record A2 + A3 demo videos. Multiple takes.
- **Day 13**: A5 (smoke test on fresh state). Submit.
- **Day 14**: Buffer. Pivot if A5 finds a blocker.

Skip C6 + C7 — too large for the timeframe and require on-chain work + audits.

---

## Part 5 — Submission package checklist

Per Colosseum's stated requirements + observed past-winner patterns:

### Required artifacts
- [ ] **Pitch video, ≤ 3 min.** Hosted on YouTube or Loom (not Vimeo — Colosseum has had access issues). Public link.
- [ ] **Technical demo video, 2–3 min.** Same hosting.
- [ ] **GitHub repo URL.** Must be accessible to judges (public, OR private with `colosseum` org granted read).
- [ ] **Project submission form** at https://arena.colosseum.org with: product name, description, team background, both video URLs, deployed URL, GitHub URL.
- [ ] **Deployed URL** that *works* in a fresh incognito browser. (= A5)

### Strongly recommended (non-required but observed in winners)
- [ ] **One-page deck** (Notion / Google Slides / PDF) covering: problem, solution, screenshots, team, traction, roadmap. Linked from the submission form.
- [ ] **README hero section** with the 1-paragraph pitch + live URL + video link, so the GitHub README is its own marketing surface.
- [ ] **DEPLOYMENTS.md** kept current (clear-msig has this — verify it stays accurate).
- [ ] **Twitter post** announcing submission, tagging @colosseum + @solana. Even a small thread = "real users / real conversations" signal.
- [ ] **Telegram/Discord channel** linked from README for judge questions. Even an empty channel signals "we're real".

### Judge-facing demo state (= A1)
- [ ] Funded payer keypair with ≥ 5 SOL devnet.
- [ ] One demo wallet (`treasury-demo` or named for the team) bound to all 5 chains.
- [ ] One transfer intent already approved.
- [ ] One active proposal mid-approval, so judges see the live ApprovalBitmap update.
- [ ] One executed proposal in the Activity tab so the tx-history feature shows real data.
- [ ] Shareable URLs to each of the above included in the pitch deck.

### Operational
- [ ] Fly machines stay warm during judging week (set `min_machines_running = 1` in fly.toml; trades a few cents/day for reliability).
- [ ] Vercel domain stable. Custom domain (`clearmsig.app`?) is a credibility upgrade if the team has 30 minutes.
- [ ] Email + handle of one team member listed on the submission form for judge questions.

---

## Risks / unknowns

- **Track structure for Frontier 2026 not public on the landing page.** Don't assume Cypherpunk's tracks (Consumer/DeFi/Infra/RWA/Stablecoin) carry over. Confirm via Arena portal once registered.
- **Ika pre-alpha is mock-MPC, not real distributed signing.** Judges will probably ask. Have an answer: "Ika's network is in pre-alpha; we're shipping against the published mock signer, and the cryptographic flow is real (DKG, presign, sign, broadcast). Production rollout will use Ika alpha 1 when it ships."
- **Devnet state is wiped periodically.** The judge-state seeding may need to be re-run if Solana devnet resets between submission and judging.
- **No security audit on the on-chain program.** This is the biggest credibility gap vs. Squads (3 audits + formal verification). For Colosseum, "open source + Quasar-built + actively iterating" is acceptable; for production it isn't.

---

## Sources

- [Colosseum: Solana Frontier Hackathon](https://colosseum.com/frontier)
- [Colosseum: Hackathon FAQ](https://colosseum.com/hackathon)
- [Perfecting Your Hackathon Submission — Colosseum blog](https://blog.colosseum.com/perfecting-your-hackathon-submission/)
- [Cypherpunk Winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/)
- [Breakout Winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-breakout-hackathon/)
- [Squads Protocol v4 GitHub](https://github.com/Squads-Protocol/v4/)
- [Squads docs](https://docs.squads.so/main)
- [Solana Compass — Squads](https://solanacompass.com/projects/squads)
