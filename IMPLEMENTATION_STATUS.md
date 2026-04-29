# Clear-MSIG-IKA · Implementation Status

A single source of truth for what is built, what works, and what is left to make the product fully functional. Reading this document end-to-end takes about ten minutes and should give a complete mental model of where the project stands today.

For the original phased plan see [`DEVELOPMENT.md`](./DEVELOPMENT.md). For the product narrative see [`README.md`](./README.md).

---

## 0. What we are building

A Solana multisig that signs **human-readable intents** instead of raw bytes, then drives native transactions on Ethereum, Bitcoin, Zcash, ERC-20, and Solana via Ika dWallet 2PC-MPC. Every signature is an Ed25519 signature over a sentence such as:

```
expires 2026-04-20 18:00: approve transfer 0.5 ETH to 0x71Ca...Ae23 | wallet: treasury proposal: 42
```

The on-chain `clear-wallet` program rebuilds that exact sentence from the proposal state, verifies every approver's signature with `brine_ed25519::sig_verify`, then either runs a Solana CPI (for local intents) or CPIs the Ika `approve_message` instruction (for cross-chain intents).

Three trust zones, no custody in the middle:

| Zone | Trusted for | What it cannot do |
| ---- | ----------- | ------------------ |
| Browser wallet (user) | Signing offchain messages | Forge other signers, see backend keys |
| Stateless relayer (gasless) | Paying Solana fees, forwarding pre-signed envelopes | Forge user signatures, change policy |
| On-chain program | Verifying signatures, enforcing thresholds, driving Ika MPC | Anything the program does not encode |

---

## 1. Architecture cheat sheet

```
[Browser wallet] --signMessage(intent)-->  [Stateless relayer]  --pre-signed--> [clear-wallet program] --CPI--> [Ika MPC] --native sig--> [ETH / BTC / SOL / ZEC]
```

Five repos / surfaces:

```
clear-msig-ika/
├── programs/clear-wallet/     # Quasar Solana program (Rust)
├── cli/                       # Rust CLI (read paths, pre-sign, dry-run, submit)
├── e2e/                       # End-to-end test harness
├── backend-api/               # Stateless relayer (Rust, Axum)
└── frontend/                  # Next.js 15 + Tailwind + Quasar wallet adapter
```

Identifiers worth memorising:

- `CLEAR_WALLET_PROGRAM_ID = ahVmthS8EwXMpckBQdxGeHmbFghxoqKBaFjSCizcvFL` (Solana devnet — see [DEPLOYMENTS.md](DEPLOYMENTS.md))
- 5 on-chain account discriminators: `ClearWallet=1`, `Intent=2`, `Proposal=3`, `IkaConfig=4`, `DwalletOwnership=5`
- Offchain message header: 16-byte `\xffsolana offchain` domain + version(1) + format(1) + length(2 LE) + body

---

## 2. What is implemented (Phases 0 → 6)

### Phase 0 · Compile and deploy unblocks · ✅ Complete

- `programs/clear-wallet/src/tests.rs` — duplicate `wrap_offchain` removed; `cargo test -p clear-wallet` builds.
- `cli/src/quasar_client/create_wallet.rs` — rewritten to the DynVec form expected by the deployed Quasar.
- `cli/src/instructions.rs` — switched to the `CreateWalletArgs` struct.
- `e2e/src/quasar_client/{create_wallet, bind_dwallet, ika_sign}.rs` — added `dwallet_ownership`, DynVec form, and the post-redesign API shapes.
- `Cargo.toml` pins: Ika SDK at `3bd7945e012950e54fb4d0057b72a7d466556fc1`, `quasar-lang` at `branch = "fix/signer-check-and-wincode-versions"`.

### Phase 1 · CLI pre-signed mode · ✅ Complete

- `PreSignedMessageSigner` (`cli/src/signing.rs`) verifies the `(signer_pubkey, signature)` tuple against the message the CLI itself rebuilds, refusing to sign on byte-layout drift.
- Five new global flags wired into `CliGlobals`: `--signer-pubkey`, `--signature`, `--params-data`, `--dry-run`, plus the existing keypair flags.
- `RuntimeConfig` extended with `params_data_override`, `dry_run`, `pre_signed`.
- `cli/src/output.rs` ships `DryRunDescriptor`, `print_dry_run`, `hex_of` helpers.
- Intent and proposal commands honour `params_data_override` and emit the descriptor when `--dry-run` is set.
- `cli/src/ika.rs` exposes a unified `signing_params(chain_kind) -> (DWalletCurve, DWalletSignatureScheme)` and the `--force-curve25519` knob is gone.

### Phase 2 · Backend relayer rewrite · ✅ Complete

- `backend-api/src/main.rs` rewritten around a `PreSigned` envelope type.
- `/prepare/**` dry-run routes return the exact bytes the browser must sign.
- Pre-signed submit routes (`/wallets/<name>/intents/{add,remove,update}`, `/wallets/<name>/proposals`, `/proposals/<pda>/{approve,cancel,cleanup}`).
- `RateLimiter` middleware (the only abuse control; admin gating removed entirely per project decision).
- SSE `stream_execute_proposal` route streams Ika MPC progress events back to the browser.
- Membership lookups use `getProgramAccounts` with `memcmp` filters; struct sizes corrected to 14 / 7 / 9 / 5 / 5 (param/account/instruction/data-segment/seed entries).
- `tokio-stream`, `futures-core`, `futures-util` added to `backend-api/Cargo.toml`.
- `.gitignore` and `backend-api/.env.pre-alpha` shipped for secrets hygiene plus first-run defaults.

### Phase 3 · Frontend msig library · ✅ Complete

Byte-exact mirror of the on-chain message builder, all under `frontend/src/lib/msig/`:

- `hash.ts` — sha256, keccak256, toHex, fromHex (uses `@noble/hashes/sha2` and `/sha3`).
- `datetime.ts` — Howard Hinnant civil-date `formatTimestamp` over BigInt.
- `offchain.ts` — `wrapOffchain` / `unwrapOffchain`, exact 20-byte header.
- `definition.ts` — ParamType, ConstraintType, AccountSourceType, SegmentType, SeedType enums + `paramByteSize`, `paramOffsetAt`.
- `encode.ts` — `encodeParams` mirrors `cli/src/params.rs::encode_params` byte for byte.
- `render.ts` — template rendering with `{N:10^D}` decimal-shift, including U64 / U128 / Bytes20 / Bytes32 paths.
- `message.ts` — `buildSignableMessage` dispatches AddIntent / RemoveIntent / UpdateIntent / Custom and returns `{wrapped, body, bodyText}`.
- `accounts.ts` — `parseWallet`, `parseIntent`, `parseProposal`, `parseIkaConfig`, `parseDwalletOwnership` via a shared `Reader` class.
- `pda.ts` — every PDA helper (`findWalletAddress`, `findIntentAddress`, `findProposalAddress`, `findIkaConfigAddress`, `findDwalletOwnershipAddress`, `findCpiAuthority`, `deriveWalletPdas`).
- 34 vitest unit tests covering datetime, offchain, encode, render, message — all green.

### Phase 4 · Frontend direct-from-chain reads · ✅ Complete

- `lib/chain/client.ts` — `CLEAR_WALLET_PROGRAM_ID`, `getConnection()` singleton, `DEFAULT_COMMITMENT = "confirmed"`.
- `lib/chain/wallets.ts` — `fetchWalletByName`, `fetchWalletByPda`.
- `lib/chain/intents.ts` — `listIntents` with batched `getMultipleAccountsInfo` (100-key chunks).
- `lib/chain/proposals.ts` — `fetchProposal`, `listProposalsForWallet`.
- `lib/chain/chainBindings.ts` — `listChainBindings`, `CHAIN_KIND_LABELS`.
- `lib/chain/memberships.ts` — `listMemberships` with two memcmp-filtered `getProgramAccounts` calls.
- `lib/memberships/client.ts` — direct-RPC by default, graceful backend fallback when public RPC blocks `getProgramAccounts`.
- `lib/hooks/useProposalSubscription.ts` — `onAccountChange` websocket pumps parsed updates into TanStack Query cache.
- `lib/hooks/{useWalletWorkflow,useIntentWorkflow,useProposalWorkflow}.ts` — reads go direct, mutations still go through the relayer.

### Phase 5 · Frontend write flows · ✅ Complete

- `useSignWithWallet` — single hook over `wallet.signMessage`, returns `{signer_pubkey, signature}` with a typed `WalletSignError` class.
- `Toast` system — dependency-free, success / error / info, link chips, details disclosure, sessionStorage dismiss.
- `PreAlphaBanner` — dismissible amber strip on `/app/*`.
- `TypedParamInput` — type-aware input with `paramTypeLabel` and decimal-shift hint preview.
- `SignablePreview` — terminal-styled "human readable | signed bytes" pane with copy buttons.
- `ApprovalBitmap` — live framer-motion animated approver dots with threshold pill.
- `ProposalCard` — full rewrite using `useIntentWorkflow` + `useProposalWorkflow` + `useSignWithWallet`. Builds the message client-side every keystroke and submits via `backendApi.submit.createProposal`.
- `IntentCard` — full rewrite with Add / Update / Remove modes, curated template catalogue (SOL, SPL, ETH, ERC-20, BTC, ZEC), chip-based approver/proposer inputs, prepare → sign → submit flow.
- `app/proposals/[proposal]/page.tsx` — deep-linkable proposal detail with status hero, live `ApprovalBitmap`, `SignablePreview`, approve/cancel via prepare → sign → submit, SSE-streamed Ika execute, cleanup.
- `app/wallet/[name]/page.tsx` — chain bindings grid, PDA panel, intent table, recent proposals.
- `MyOrganizationsCard` — deep-links each org into its detail page.
- `CreateWalletCard` — three-step wizard, parallel non-blocking invite emails, toast feedback, auto-redirect to the new wallet.
- 34/34 vitest tests passing, `tsc --noEmit` clean.

### Phase 6 · Landing page and design system · ✅ Complete

- Shared design tokens in `tailwind.config.ts`: brand-green / brand-emerald / brand-green-bright, font families (Inter / Space Grotesk / JetBrains Mono via `next/font`), shadow-glow / glow-hover / glow-strong / card-shadow / card-dark, `pulseGlow` / `float` / `shimmer` / `scanLine` / `autoScroll` keyframes.
- `globals.css` — focus-visible outline, prefers-reduced-motion guard, premium scrollbar, wallet-adapter overrides.
- `cardTokens.ts` — single source of truth for every landing card. Every card across every section uses `CARD.{radius, padding, gapInner, title, body, eyebrow, mono, iconWrap, iconWrapRadius, iconSize}` and every marquee uses `MARQUEE_ITEM_WIDTH` and `MARQUEE_GAP`.
- Landing sections, all clamp-based and responsive end-to-end:
  - `HeroSection` (terminal-typing GSAP animation, status pill, scroll prompt, no Connect Wallet CTA)
  - `ProblemSection` (Bybit / Drift / You incident cards)
  - `BeforeAfterSection` (mobile vertical stack with glowing arrow, desktop three-column with arrow)
  - `HowItWorksSection` (mobile auto-scroll marquee, hidden on lg)
  - `ChainsGridSection` (mobile auto-scroll marquee, hidden on lg)
  - `HowItWorksChainsShowcase` (desktop dual marquees, opposite directions)
  - `ArchitectureSection` (slow right-scrolling marquee on every breakpoint)
  - `LiveStatsSection` (3-up static, animated count-up via `useInView`, real `getProgramAccounts` counts)
  - `SystemCircuitSection` (animated SVG blueprint with `animateMotion` packets)
  - `VaultConnectSection` (dual vault doors closing on scroll, single Connect Wallet CTA)
  - `LandingFooter`
- `ScrollGuide` — right-edge signal thread + mobile bottom pill that pull the eye toward the vault.
- `Skeleton`, `EmptyState`, `ErrorState` shared primitives, retrofitted into proposal-detail, wallet-detail, ProposalList, MyOrganizationsCard.
- `app/opengraph-image.tsx` — server-rendered 1200×630 OG image via `next/og`. No PNG asset required.
- `layout.tsx` metadata — title template, OG, Twitter card, viewport, theme color, preconnect to devnet RPC.

### Quasar lint hardening · 🟡 13 errors → 2 (build still failing)

- `programs/clear-wallet/src/instructions/bind_dwallet.rs` — declarative `seeds = [...]` on `dwallet_ownership` and `cpi_authority`, per-field `#[allow(quasar::*)]` on the Ika-external accounts (`dwallet`, `dwallet_program`, `ika_config`).
- `programs/clear-wallet/src/instructions/ika_sign.rs` — same treatment. `dwallet_ownership` + `cpi_authority` now have declarative seeds; `ika_config` keeps its handler-side derivation because the seed depends on `intent.chain_kind` (account data, not instruction args).
- `approve.rs` / `cancel.rs` / `execute.rs` / `cleanup_proposal.rs` — `#[allow(quasar::cross_instruction)]` on the `proposal` field, `#[allow(quasar::writable_no_authority)]` on program-owned PDA writables.
- `quasar build` output as of last run: **2 errors, 13 warnings**, both errors on `cpi_authority` (Quasar treats literal-only `seeds = [b"..."]` as not satisfying L001 because no graph edges are produced).

---

## 3. What is left to be done

### A. Quasar lint clean-out · 🟡 2 errors remaining + linter quirk

Two remaining L001 errors on `cpi_authority` in `BindDwallet` and `IkaSign`. Fix is one line each:

```rust
#[allow(quasar::unconstrained)]
#[allow(quasar::unchecked_account)]
#[account(seeds = [b"__ika_cpi_authority"], bump)]
pub cpi_authority: &'info UncheckedAccount,
```

The 11 L009 cross-instruction warnings cannot be silenced through `#[allow(quasar::cross_instruction)]` — Quasar's `cross::check_cross_instruction` does not consult the suppression list (verified by reading `idl/src/lint/cross.rs:22-110`). Two paths forward:

1. **Live with the warnings.** They do not block the build once the L001 errors above are fixed; the build summary will read "0 error(s), 13 warning(s)". This is what the project currently lands on.
2. **Add the missing `has_one` directives.** Adding `has_one = proposer, has_one = rent_refund` (and on `CleanupProposal` also `has_one = wallet, has_one = intent`) clears the warnings at the cost of every downstream caller (CLI, frontend, e2e) passing those accounts. This is a small client-side change, mostly mechanical.

The recommended path is option 1 in the short term, option 2 once the rest of Phase 7 is done so we can re-test in one sweep.

### B. Phase 7 · Testing and hardening · 🔴 Not started

Per `DEVELOPMENT.md` §9:

1. **On-chain tests** — `cargo test -p clear-wallet tests::` runs clean across every instruction. Negative tests for: signature failure, expiry, threshold not met, intent not approved, timelock not elapsed.
2. **CLI tests** — pre-signed mode with deliberate (signer / signature / message) drift must be rejected.
3. **Backend tests** — `/prepare/**` and signed submit routes; rate limiter sanity; SSE stream emits at least one progress event before `done`.
4. **E2E tests** — wallet create → bind chain → add intent → propose → approve → execute, all from the CLI driving the real program on a local validator. Already scaffolded in `e2e/`; needs the post-Phase-2 API shapes wired through.
5. **Frontend integration tests** — `wallet.signMessage` mock, prepare/submit happy paths, error toasts on `WalletSignError`.

Acceptance: every test green on CI, including the negative-test matrix.

### C. Phase 8 · Demo prep · 🔴 Not started

1. Devnet deploy of `clear-wallet` at the declared program ID (verify on-chain).
2. Backend relayer deployed somewhere reachable by the frontend (Fly / Railway / a small VM). Sponsored-gas keypair funded with devnet SOL.
3. CLI binary on the relayer host, with `IKA_DWALLET_PROGRAM_ID` and `IKA_GRPC_URL` configured.
4. Email service for invites (`nodemailer` route at `/api/invitations`) — currently expects SMTP creds in env; either point at a real provider or stub for the demo.
5. Demo script + recording showing: create wallet → invite signers → bind ETH chain → propose ETH transfer → all approvers sign → execute → tx lands on Sepolia.
6. Pitch deck refresh with screenshots of the new landing page and the live signing view.

### D. Open product-side items · 🔴 Not started

- Final domain (`clear-msig.xyz` is set in metadata; confirm or change).
- Logo asset under `/public/assets/clear-msig.svg` — currently the header reuses `solana.png`; replace with a real wordmark.
- ER-20 contract list curation for the destination-chain UI.
- Long-form Architecture article (linked from the landing's removed Open-source section before that section was deleted; needs a new home if we still want it).

### E. Polish that surfaced during Phase 6 review · 🟡 Partially done

- Em-dash / placeholder cleanup across both source and visible strings — done.
- Mobile responsive audit at 320 / 360 / 414 / 768 / 1024 — completed for landing, completed for proposal-detail, completed for wallet-detail, completed for the new BeforeAfter vertical stack, completed for LiveStats compact 3-up.
- Outstanding mobile audit items: long wallet names, very long approver lists (>16 chips), proposal action SSE log overflow on narrow screens.

---

## 4. Concrete next steps to "fully functional"

The shortest path from today to a demo-ready, end-to-end working system:

1. **Close Quasar lint** (≈ 5 min) — add the two `#[allow(quasar::unconstrained)]` lines on `cpi_authority` in BindDwallet and IkaSign. Re-run `quasar build` from `programs/clear-wallet/` and confirm `0 error(s)`.

2. **Deploy `clear-wallet` to devnet** (≈ 30 min) — `quasar deploy --cluster devnet`, capture the deployment signature, verify the declared program ID is occupied.

3. **Bring up the backend relayer** (≈ 1 hour) — `cargo build --release -p backend-api`, configure `.env.pre-alpha` with the relayer keypair path, the CLI binary path, and the Solana RPC URL. Smoke test with `curl /health`.

4. **Run the full e2e harness** (≈ 1 hour) — `cargo test -p e2e -- --include-ignored` against the deployed program. Fix any post-Phase-2 API drift this exposes.

5. **Wire the frontend to the deployed stack** (≈ 30 min) — set `NEXT_PUBLIC_BACKEND_API_URL` to the relayer's URL, `NEXT_PUBLIC_DEFAULT_WALLET_NAME` to the chosen demo wallet, the Ika `*_DWALLET_PROGRAM_ID` and `*_GRPC_URL` to the pre-alpha endpoints. `npm run build` and deploy on Vercel.

6. **Click through the golden path** in a browser (≈ 30 min) — connect wallet, create wallet, invite a co-signer, bind ETH chain, propose a transfer, approve from both signers, execute via Ika, confirm the Sepolia tx on Etherscan.

7. **Write the negative-test matrix** (≈ 2 hours) — wrong signature, expired expiry, threshold not met, double-approve, timelock not elapsed, intent removed mid-flight. Add as `tests/integration_negative.rs` so future regressions are caught.

8. **Record the demo** (≈ 30 min) — 90-second screen capture of steps 5–6 plus a quick voiceover.

After step 8 the project is demo-ready and ships behind the existing pre-alpha banner.

---

## 5. Known issues and watch-outs

- **Public devnet RPCs rate-limit `getProgramAccounts`** — the `LiveStatsSection` and `MyOrganizationsCard` queries fall back gracefully to the backend on failure, but the backend itself still pays that cost. Watch the relayer logs.
- **`L009` Quasar lint warnings cannot be `#[allow]`-suppressed** because Quasar's `check_cross_instruction` ignores the suppressions list. Tracked upstream; nothing actionable on our side besides adding the suggested `has_one` directives.
- **CLI / frontend / backend API shape drift** — every signed envelope ships a `params_data_hex` plus `signer_pubkey` plus `signature` plus `expiry`. If any side adds or renames a field, every other side must move with it. See `frontend/src/lib/api/types.ts::PreSignedPayload` for the canonical shape.
- **`brine_ed25519::sig_verify` aborts on bad signatures rather than returning an error code** — the on-chain program maps the abort to `WalletError::InvalidSignature`; if you see a generic `Custom error: 0x7e` on chain, that is this.
- **The Ika pre-alpha is single-mock-signer**, not the distributed MPC network. The pre-alpha banner says so; do not strip it before mainnet readiness.
