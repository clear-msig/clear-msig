# ClearSig product roadmap

Derived from the 3 October 2026 UI/UX and product review of `apps/web`.
Status is verified against the repository. Items marked **Shipped** are in the
change that introduced this document. Everything else is **Planned** and says
what it depends on, because most of it cannot be done in the browser alone.

Nothing here changes the pre-alpha trust statement: devnet only, Ika is a
single mock signer, and no item below should be described to users as live
until its acceptance criteria are met.

## Correction to the original review

The review said new wallets are created with `min(2, members)` as the
threshold. That was wrong. `assertNewWalletSetupSupported`
(`lib/chain/legacySetup.ts`) only accepts threshold `1`, because the setup
proposal can only be approved by its creator. Every wallet therefore starts
creator-only at 1-of-1, and the Pro "import signers" path threw a cryptic
error for any imported list longer than zero. Teammates, threshold and delay
must be added afterwards through governance. The fix below follows that
reality instead of pretending the threshold can be chosen at creation.

## Shipped

| Item | What changed |
| --- | --- |
| Setup checklist | `TeamSetupChecklist` on the wallet page guides a 1-of-1 wallet to add teammates, require more than one approval, and add a delay. Derived from the on-chain intent; dismissible. |
| Import signers | No longer fails. The wallet is created creator-only; imported addresses are remembered and counted in the checklist. Copy now states that each teammate is added with their own approval. |
| Readable type | Every `text-[9px]`, `text-[10px]` and `text-[11px]` (696 uses, 143 files) is now `text-xs` (12px). |
| Encoding | Garbled box-drawing and bullet characters repaired in three source files. |
| Mobile home | The status line ("N need your approval") is visible on mobile; it was desktop-only. |
| Activity CSV | Full recipient address instead of a shortened one; new trailing `Tx match` column says when the hash was joined by time proximity from this device's log. Existing columns keep their order. |
| Install | `package-lock.json` is back in sync so `npm ci` works. |

Not covered by browser tests: visual layout after the type-size change. Check
dense chips and uppercase labels at 390px before release.

## Phase 1: Make team state shared (0-6 weeks)

Goal: a second teammate sees what the first one set up.

Depends on: a backend service with authenticated, per-wallet storage. The
existing Axum API (`apps/api`) is the natural home.

1. **Shared address book.** Replace device-local contacts and member
   nicknames (`lib/retail/contacts.ts`, `useContacts`) with per-wallet,
   server-synced entries. Local storage stays as an offline cache.
   *Done when:* a name saved by one member shows for every member on a
   different device.
2. **Viewer / auditor role.** Today "watcher" is a localStorage entry
   (`lib/retail/roles.ts`). Store it server-side first (read access to the
   wallet's feed); on-chain read-only roles need a program change and go in
   Phase 3. *Done when:* an auditor can open the wallet without being able
   to propose or approve, on any device.
3. **Always-on notifications.** Move email and webhook delivery server-side,
   keyed to a verified address, with per-event routing. Today they fire only
   while a tab is open and webhook secrets sit in plain `localStorage`.
   *Done when:* a pending approval emails an approver with no tab open, and
   no secret is stored in the browser.
4. **Proposal memo and discussion.** Add a memo / invoice reference at
   creation and comments plus a decline reason on the request page
   (`proposals/[proposal]/page.tsx`). Stored off-chain, clearly labelled as
   not part of what is signed. *Done when:* a finance reviewer can see why a
   payment exists without leaving the request.
5. **Server-side saved schedules.** Pro recurring schedules are kept in
   `localStorage` (`lib/pro/treasury.ts`). Persist them with the wallet.

## Phase 2: Governance and policy UX (4-10 weeks)

Goal: one understandable place for "who must approve what".

1. **Single Rules hub.** Merge `policy`, `policies`, `rules`, `allowances`,
   `budget` and `settings` into one page with three clearly named layers:
   what the program enforces, what this app checks before signing, and what
   is only a reminder. Show which layer blocked a send.
2. **Choose approvals at setup, safely.** Since threshold cannot be set at
   creation, make the checklist's threshold and delay steps one-tap flows
   that prepare the governance request, instead of links to a settings page.
3. **Tiered approvals.** "Over X needs N approvals including role Y."
   Needs program support for amount-conditioned thresholds; extend the
   existing `require-extra-approvers` rule action rather than adding a new
   system.
4. **Pre-send simulation.** "What happens if I send this": which rules apply,
   what is blocked, approvals needed, earliest execution time.
5. **Price-stable caps.** USD weekly caps are converted to native-token
   snapshots and go stale when prices move. Either cap in the asset or show
   the snapshot date and re-snapshot on a schedule.

## Phase 3: Money operations for finance teams (8-16 weeks)

1. **Accounting-grade export.** Per-transaction fiat value at execution time,
   categories and cost centres, memo and invoice reference (from Phase 1),
   and join to the on-chain proposal address rather than a 30-minute time
   window on one device. The `Tx match` column shipped above is a stopgap.
2. **Real connectors.** QuickBooks and Xero are only labels today
   (`getProTreasuryRuntime`). Build OAuth connectors or remove the labels.
3. **Real multisig import.** "Import Squads / Safe" is a signer list. A real
   import reads an existing multisig, its owners and threshold, and offers a
   guided move of funds and history.
4. **Address-risk screening.** Sanctions, known-scam and first-time-recipient
   signals at compose time, as a warning tier distinct from policy blocks.
5. **Payroll and vendor payments.** Invoice-to-payment flow, per-category
   approvers, reconciliation view.
6. **On-chain read-only role** and org-level admin (SSO, an org above
   wallets, an API for outside systems). Needs a program change and an audit.

## Phase 4: Consumer reach and trust (ongoing)

1. **Push notifications** (web push, then a native shell) for "needs your
   approval", the core loop of a shared wallet.
2. **Recovery in the wallet flow.** Offer Secure recovery during wallet setup
   instead of as a separate product.
3. **Localisation.** There is no i18n layer today. Introduce message catalogs
   and locale-aware currency before adding languages.
4. **Independent verifier.** A standalone page or CLI that takes the
   canonical bytes and shows the same sentence the program verifies,
   separate from the signing app. Qualify physical-device displays.
5. **External audit and production MPC.** Release blockers already listed in
   `docs/product-implementation-status.md`.

## Phase 0 decisions that gate the rest

These need a product decision, not engineering time.

1. **Pick the wedge.** Six surfaces (Personal, Pro, Agents, Secure, P2P DeFi,
   Payments) share one app; four are marked live on a devnet pre-alpha. The
   agents code is about 52k of 170k lines. Recommend leading with Pro or
   Personal and moving the others behind an explicit "labs" entry.
2. **Accent colour.** `docs/design/calm-interface.md` specifies a muted sage
   accent. The rendered landing and chooser use neon lime on black. Either
   update the doc or the palette; do not leave both.
3. **Asset-first send.** Send is split into per-chain routes, each needing a
   chain binding first. Decide whether bindings are created automatically the
   first time an asset is used.

## Out of scope for the browser

Server storage, notification delivery, connectors, program changes and the
audit cannot be shipped as frontend edits. They are listed so they are not
mistaken for UI work.
