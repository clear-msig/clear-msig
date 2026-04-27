# Clear-MSIG-IKA — Development Plan

This is the single source of truth for what we're building, in what order, and
how we know each piece is done. Every task has a **What / Why / Where /
Acceptance** block. Work top-to-bottom; no phase starts until the previous
phase's acceptance criteria pass.

---

## 0. What we're shipping

**Product:** A clear-sign multisig treasury on Solana that custodies assets on
Solana, Ethereum (mainnet + L2s), Bitcoin, and Zcash via Ika dWallet MPC.
Signers approve human-readable messages with their browser wallet or Ledger.
No blind signing. No central signing authority. No database.

**Judging pitch in one breath:** "Bybit and Drift lost millions because
humans signed opaque hex. We built a multisig where every signature is over a
human-readable string that the Ledger screen can display verbatim — and one
Solana policy controls native assets on Ethereum, Bitcoin, and Zcash via Ika
MPC, all enforced on-chain."

**What is actually implemented in the code today** (re-read after Phase 0
clean-up): **all five chains** from the README are built end-to-end — Solana
via Ika dWallet (not a local vault anymore), EVM 1559 native, ERC-20, Bitcoin
P2WPKH, and Zcash transparent. The on-chain program has matching preimage
builders (`programs/clear-wallet/src/chains/{solana_dwallet,evm,bitcoin,zcash}.rs`)
and the CLI has matching broadcast adapters
(`cli/src/chains/{solana_broadcast,evm,bitcoin,zcash}.rs`).

**Scope decision for the hackathon:** ship every chain the code already
supports. The "skip Zcash / skip Solana-via-Ika" advice in the earlier draft
of this doc was based on an older snapshot — both are in the code now, so the
work is polish, not rebuild. Focus energy on the signing architecture
(browser-signs, phases 1–5) and frontend UX (phase 6).

**Scope in one table:**

| Chain | On-chain preimage | Off-chain broadcast | Status |
|---|---|---|---|
| Solana (via Ika Curve25519/EdDSA) | `keccak256(tx-sighash)` | `sendTransaction` | ✅ built |
| EVM 1559 (ETH/L2s/Sepolia) | `keccak256(RLP)` | `eth_sendRawTransaction` | ✅ built |
| ERC-20 | `keccak256(RLP w/ transfer calldata)` | `eth_sendRawTransaction` | ✅ built |
| Bitcoin P2WPKH | `sha256d(BIP143)` | Esplora `POST /tx` | ✅ built |
| Zcash transparent (ZIP-243) | BLAKE2b-256 personalised `ZcashSigHash \|\| branch_id` | Zcash RPC | ✅ built |

The README's "Supported Chains" table is now accurate; don't rewrite it.
We will, however, add a "Known limitations" section documenting the Ika
pre-alpha mock's signer constraints (currently single mock signer, not
distributed MPC).

**SDK pin lock-in (done in Phase 0):**

- `ika-grpc` / `ika-dwallet-types` pinned to `3bd7945e012950e54fb4d0057b72a7d466556fc1`
  (2026-04-17, latest post-redesign commit). Exports `DWalletSignatureScheme`,
  `UserSecretKeyShare`, `VersionedDWalletDataAttestation`,
  `VersionedPresignDataAttestation`. The earlier pin (`40ba20db`) predates the
  2026-04-13 "Redesign gRPC types, versioned attestations, all schemes" commit
  and cannot compile against the current `cli/src/ika.rs`.
- `quasar-lang` pinned in `e2e/Cargo.toml` to `branch = "fix/signer-check-and-wincode-versions"`
  to match `cli/Cargo.toml`. Without this, cargo resolves a stale master
  checkout (`6afb2ca`) that predates the `TailBytes` export and e2e fails to
  compile.

---

## 1. Architecture (target)

```
┌────────────── browser (user trust boundary) ──────────────┐
│                                                            │
│  Solana Wallet Adapter (Phantom / Solflare / Backpack)    │
│    • signMessage(offchain_wrapped_bytes)                  │
│    • Ledger via Solflare → device-side message display    │
│                                                            │
│  frontend/src/lib/msig/         (TypeScript — byte-exact) │
│    offchain, datetime, render, encode, message,           │
│    hash, types, accounts                                  │
│                                                            │
│  frontend/src/lib/chain/        (TypeScript — direct RPC) │
│    memberships, wallet, intents, proposals                │
│    (read-only, no backend dependency)                     │
│                                                            │
│  React app: typed forms → preview → signMessage → relay   │
│                                                            │
└────────────────────────────┬───────────────────────────────┘
                             │ HTTPS (pre-signed payload)
                             ▼
┌─────────── backend relayer (operator trust) ───────────────┐
│                                                            │
│  Axum — stateless. Holds gas payer keypair ONLY.          │
│  Never computes multisig ed25519 signatures.              │
│  Rate-limits by proposer_pubkey.                          │
│                                                            │
│  Delegates to: clear-msig CLI in --pre-signed mode        │
│                                                            │
└────────────────────────────┬───────────────────────────────┘
                             │ Solana RPC
                             ▼
┌──────────── clear-wallet program (unchanged) ──────────────┐
│ brine_ed25519::sig_verify ∥ threshold ∥ timelock ∥ ownership│
└────────────────────────────────────────────────────────────┘
```

**Three trust zones, three keypair families:**

| Zone | Key material | Scope |
|---|---|---|
| User browser | User's wallet private key | Signs ed25519 messages only. Never pays gas. |
| Relayer | Gas payer | Pays Solana fees, relays CLI calls. Cannot impersonate signers. |
| On-chain program | Vault PDA + CPI-authority PDA | Enforces policy, signs CPIs. |

**Why this wins:** if the relayer disappears, users can still read on-chain
state and (with a fallback "submit from my own wallet" button, Phase 5) send
txs themselves. The relayer is a convenience, not a dependency. That's the
decentralization story.

---

## 2. Phase 0 — Compile & Deploy Unblocks — ✅ **COMPLETE**

**Goal (achieved):** `cargo check --workspace --all-targets` exits 0 with 0
errors, 8 warnings (all dead-code / unused-var on deliberately-future-use
helpers). The devnet deploy is the user's manual step —
`./scripts/prealpha/deploy-clear-wallet-devnet.sh` — and is the only Phase 0
item that runs outside this repo.

**Exit criteria (met):** workspace builds clean. Phase 1 work can begin.
Running the Phase 3/4 check scripts against devnet requires the deploy.

### What was fixed (summary)

All nine planned sub-tasks (0.1–0.9) plus two latent bugs discovered while
verifying the build:

- **0.1** removed duplicate `fn wrap_offchain` in `programs/clear-wallet/src/tests.rs`
- **0.2** rewrote `cli/src/quasar_client/create_wallet.rs` to `DynVec<[u8;32]>` form; `cli/src/instructions.rs::create_wallet` now takes a `CreateWalletArgs` struct and matches the on-chain signature
- **0.3** rewrote `e2e/src/quasar_client/{create_wallet,bind_dwallet,ika_sign}.rs` — added `dwallet_ownership`, `DynVec` form, new Ika API shapes for `DKG` / `Presign` / `Sign`
- **0.4** deleted `backend-api/keys/signer-funded.json`, hardened `.gitignore` (includes node_modules, .next, .env, .env.local, .env.pre-alpha, but keeps `*.example`)
- **0.5** backfilled `backend-api/.env.pre-alpha` with `CLEAR_MSIG_DEFAULT_{DWALLET_PROGRAM,GRPC_URL,DEST_RPC_URL}`
- **0.6** fixed `backend-api/src/main.rs` struct-size constants to `14/7/9/5/5` (were `18/34/5/13/7`)
- **0.7** removed `frontend/src/app/page.tsx.backup`
- **0.8** hid the broken `proposal cleanup` button in `ProposalCard.tsx`
- **0.9** workspace builds clean; Phase 2 check script (`check-phase2.sh`) also fixed to allowlist the same-origin `/api/invitations` fetch
- **+** bumped `ika-grpc` / `ika-dwallet-types` pin from `40ba20db` → `3bd7945e` — the CLI had already been rewritten to the new API shape but the Cargo pin still referenced the pre-redesign commit
- **+** pinned `quasar-lang` in `e2e/Cargo.toml` to `branch = "fix/signer-check-and-wincode-versions"` — cargo was resolving a stale master (`6afb2ca`) that predates the `TailBytes` export

### Scope discovery while cleaning up

The codebase is wider than the original map. Added files / expanded modules
(all since my first code read):

```
programs/clear-wallet/src/chains/solana_dwallet.rs   ← new, Solana via Ika
programs/clear-wallet/src/chains/zcash.rs            ← new, ZIP-243 BLAKE2b-256
cli/src/chains/solana_broadcast.rs                   ← new
cli/src/chains/zcash.rs                              ← new
cli/src/ika.rs                                       ← grew ~600 → 954 lines
                                                        (UserSecretKeyShare,
                                                         VersionedDWalletDataAttestation,
                                                         VersionedPresignDataAttestation,
                                                         message_metadata,
                                                         load_attestation)
```

`ChainKind::Solana = 0` is no longer a local-vault CPI — it is now an Ika
Curve25519 dWallet whose pubkey IS the Solana address. No vault PDA is
used for cross-chain intents. This flows through section 1's architecture
(the relayer is a pure pay-gas role; every chain including Solana uses the
same Ika-driven signing path).

The per-sub-task blocks below are kept for reference / traceability.

### 0.1 Fix duplicate `fn wrap_offchain` in tests

**What:** Delete one of the two `fn wrap_offchain` definitions in
`programs/clear-wallet/src/tests.rs` (lines 64 and 121).

**Why:** Duplicate function definition — `cargo test -p clear-wallet` won't
compile, so there is effectively zero test coverage. Judges will run this.

**Where:** `programs/clear-wallet/src/tests.rs:64` and `:121`.

**Acceptance:**
- `cargo test -p clear-wallet tests::` compiles and all non-ignored tests pass locally.
- Print output mentions `FULL_LIFECYCLE`, `TOKEN_TRANSFER`, etc. passing.

### 0.2 Fix vendored `create_wallet.rs` in CLI

**What:** Replace `cli/src/quasar_client/create_wallet.rs` with the canonical
Quasar-generated version from
`programs/clear-wallet/target/client/rust/clear-wallet-client/src/instructions/create_wallet.rs`.
The generated one uses `DynVec<[u8; 32]>` for `proposers`/`approvers` in the
instruction data; the vendored copy uses `num_proposers + remaining_accounts`
which the program rejects.

**Why:** Without this, `clear-msig wallet create` against the deployed
program fails with `InvalidInstructionData` before the app does anything
useful. Hardest blocker.

**Where:**
- Overwrite `cli/src/quasar_client/create_wallet.rs` with the generated version (adjust import from `crate::ID` → `super::ID`).
- Update `cli/src/instructions.rs::create_wallet` to build `DynVec::from(proposers.iter().map(|p| p.to_bytes()).collect())` instead of the `num_proposers + remaining_accounts` shape.

**Acceptance:**
- `clear-msig wallet create --name "test" --proposers <P1>,<P2> --approvers <P1>,<P2> --threshold 2` returns JSON with `txid`, `wallet`, `vault` fields and the wallet is on devnet.
- `solana account <wallet_pda>` shows discriminator byte `1`.
- Wallet show returns correct `proposal_index: 0`, `intent_index: 2`.

### 0.3 Fix e2e vendored clients

**What:** Same treatment for `e2e/src/quasar_client/create_wallet.rs` (DynVec
form). Add the `dwallet_ownership` field to `e2e/src/quasar_client/bind_dwallet.rs`
and `e2e/src/quasar_client/ika_sign.rs` (both missing it — the program
requires it since the ownership-lock feature was added). Update
`e2e/src/main.rs` to pass it.

**Why:** E2E binary won't pass account validation without it. Judges may run
it; we may want it in our demo script.

**Where:**
- `e2e/src/quasar_client/create_wallet.rs` — rewrite to DynVec form
- `e2e/src/quasar_client/bind_dwallet.rs` — add `dwallet_ownership: Address`, place after `ika_config` in accounts vec
- `e2e/src/quasar_client/ika_sign.rs` — same
- `e2e/src/main.rs` — derive `dwallet_ownership_pda` using `["dwallet_owner", dwallet_pda]`, pass to both instructions

**Acceptance:**
- `cargo run -p e2e-clear-msig-ika -- <DWALLET_PROGRAM_ID>` against devnet runs to completion and prints `E2E PASSED`.

### 0.4 Secrets hygiene

**What:**
- Delete the committed `backend-api/keys/signer-funded.json`.
- Add `backend-api/keys/` to `.gitignore`.
- Regenerate via `solana-keygen new` (or the bootstrap script does this).
- Airdrop devnet SOL to the new key.

**Why:** Committed private keys are a red flag even on devnet. Judges notice.

**Where:** root `.gitignore` and `backend-api/keys/`.

**Acceptance:**
- `git ls-files backend-api/keys/` returns empty.
- `.gitignore` contains `backend-api/keys/`.
- `solana balance <new_signer_pubkey> --url devnet` returns ≥ 2 SOL.

### 0.5 Backfill `backend-api/.env.pre-alpha`

**What:** Add the three `CLEAR_MSIG_DEFAULT_*` env vars from
`.env.pre-alpha.example` to `.env.pre-alpha`. These become default
`--dwallet-program`, `--grpc-url`, `--rpc-url` flags for CLI invocations.

**Why:** Frontend chain-add sends only `{chain}`; backend rejects with
`bad_request: dwallet_program is required` without these defaults.

**Where:** `backend-api/.env.pre-alpha`.

**Acceptance:**
- `curl -X POST http://127.0.0.1:8080/wallets/test/chains/add -d '{"chain":"evm_1559"}'` succeeds.

### 0.6 Fix backend `/memberships` element sizes

**What:** In `backend-api/src/main.rs:361-366`, `skip_raw_vec` is called with
wrong element sizes for the intent's internal vectors. The Rust structs in
`programs/clear-wallet/src/utils/definition.rs` are:

| Type | Correct size |
|---|---|
| `ParamEntry` | `1 + 2 + 2 + 1 + 8 = 14` |
| `AccountEntry` | `1 + 1 + 1 + 2 + 2 = 7` |
| `InstructionEntry` | `1 + 2 + 2 + 2 + 2 = 9` |
| `DataSegmentEntry` | `1 + 2 + 2 = 5` |
| `SeedEntry` | `1 + 2 + 2 = 5` |

Current code uses `18 / 34 / 5 / 13 / 7`. Several are wrong.

**Why:** Wrong offsets silently return bogus membership data for any wallet
that has a custom intent. Corrupts the dashboard.

**Where:** `backend-api/src/main.rs:361-366` (inside `parse_intent_membership`).

**Acceptance:**
- After adding a custom intent to a wallet, `GET /memberships?address=<addr>` returns consistent data (wallet name, roles, intent_indexes 0,1,2,3).
- We'll replace this endpoint entirely in Phase 4, but fixing it keeps the current app usable until then.

### 0.7 Delete `page.tsx.backup`

**What:** `rm frontend/src/app/page.tsx.backup`.

**Why:** Backup files in a repo look unprofessional; judges read repos.

**Acceptance:** File absent, `git rm`'d.

### 0.8 Document known-broken cleanup path

**What:** Keep the Quasar `close` bug in the README Known Issues. Don't
demo `proposal cleanup`.

**Why:** Framework-level bug (not ours). Attempting it on-chain returns
`MissingRequiredSignature`. Not worth the fix; UI just hides the button.

**Where:** `frontend/src/components/proposals/ProposalCard.tsx` — hide the
cleanup button for now with a comment referencing the issue.

**Acceptance:** Cleanup button absent in UI.

### 0.9 Deploy clear-wallet to devnet

**What:** Run `scripts/prealpha/deploy-clear-wallet-devnet.sh`. Note the
program ID in `target/deploy/clear_wallet-keypair.json`.

**Why:** Nothing else works without this.

**Acceptance:**
- `solana program show <PROGRAM_ID> --url devnet` shows an executable binary.
- `./scripts/prealpha/check-phase3.sh` exits 0.
- `./scripts/prealpha/check-phase4.sh` exits 0.

---

## 3. Phase 1 — CLI Pre-Signed Mode

**Goal:** let the CLI accept a pre-computed ed25519 signature instead of
computing one. This is the minimum viable change that unlocks browser-side
multisig signing in Phase 4/5.

### 1.1 Add `PreSignedMessageSigner`

**What:** In `cli/src/signing.rs`, add a third variant to `MessageSigner`:

```rust
pub struct PreSignedMessageSigner {
    pubkey: [u8; 32],
    signature: [u8; 64],
}
impl MessageSigner for PreSignedMessageSigner {
    fn pubkey(&self) -> [u8; 32] { self.pubkey }
    fn sign_message(&self, _msg: &[u8]) -> Result<[u8; 64]> { Ok(self.signature) }
}
```

**Why:** Keeps the existing trait. No changes needed in commands that only
call `.pubkey()` and `.sign_message()`.

**Where:** `cli/src/signing.rs` (append).

**Acceptance:** `cargo build -p clear-msig-cli` succeeds.

### 1.2 Global `--signer-pubkey` / `--signature` / `--params-data` flags

**What:** Add three global flags in `cli/src/main.rs`:

```rust
#[arg(long, global = true)] signer_pubkey: Option<String>,   // base58 32 bytes
#[arg(long, global = true)] signature: Option<String>,       // hex 64 bytes
#[arg(long, global = true)] params_data: Option<String>,     // hex variable
```

In `cli/src/config.rs::load_config`, if `signer_pubkey` and `signature` are
both `Some`, construct `PreSignedMessageSigner` instead of
`KeypairMessageSigner` / `LedgerMessageSigner`.

**Why:** Lets the browser pre-compute + sign everything and pass it through.

**Where:** `cli/src/main.rs`, `cli/src/config.rs`.

### 1.3 Accept `--params-data` in proposal/intent commands

**What:** In `cli/src/commands/proposal.rs::ProposalAction::Create` and in
all three `cli/src/commands/intent.rs` variants (`Add`, `Remove`, `Update`),
if `--params-data` is provided (hex), use those bytes directly instead of
calling `encode_params(...)` / building the body.

Also: skip the `build_message` call when `signer_pubkey` + `signature` are
provided — the caller already signed the exact bytes they intend.

**Why:** The browser is the canonical source for "what got signed." The CLI
must not re-derive params_data from different input.

**Where:**
- `cli/src/commands/proposal.rs:112-193` (Create)
- `cli/src/commands/proposal.rs:685-770` (approve_or_cancel)
- `cli/src/commands/intent.rs:80-338` (Add/Remove/Update)

**Acceptance:**
- `clear-msig proposal create --pre-signed-mode --signer-pubkey <b58> --signature <hex> --params-data <hex> --wallet "treasury" --intent-index 3` succeeds without touching the local signer file.
- Same for `proposal approve`, `intent add`, `intent remove`, `intent update`.

### 1.4 CLI stdin-mode for large payloads (optional but clean)

**What:** If `--signature -` (hex starting with `-`), read signature from stdin.
Same for `--params-data -`. Prevents argv length limits when params_data is big.

**Why:** Solana tx params can exceed argv max on Linux (128 KiB). Not likely
for normal usage but saves a future debug session.

**Where:** Above same files.

**Acceptance:** Echoing hex into stdin works.

### 1.5 CLI outputs the signed message on `--dry-run`

**What:** Add `--dry-run` global flag. When set, for any command that would
sign or submit a tx, instead print JSON:

```json
{
  "wallet_name": "treasury",
  "proposal_index": 42,
  "intent_index": 3,
  "params_data_hex": "...",
  "expiry": 1900000000,
  "message_to_sign_hex": "ff736f6c616e61206f6666636861696e00000012..."
}
```

**Why:** Lets the browser ask the CLI "what exactly should I sign for this
action?" without ever touching the network. Eliminates guesswork during
Phase 4 TS library development — we can assert byte-for-byte equality.

**Where:** `cli/src/main.rs`, propagate through commands.

**Acceptance:**
- `clear-msig proposal create --dry-run --wallet t --intent-index 3 --param a=b` prints the above JSON and exits 0 without sending a tx.

---

## 4. Phase 2 — Backend Relayer Rewrite — ✅ **COMPLETE**

**Status summary (post-implementation):**

- Every multisig-signed write route takes a
  `PreSigned { signer_pubkey, signature, params_data_hex?, expiry }` blob
  and relays to the CLI via `--signer-pubkey / --signature /
  --params-data`. The CLI's `PreSignedMessageSigner` re-verifies the
  signature against the message it rebuilds; byte-layout bugs fail loud
  instead of silently submitting garbage.
- New `/prepare/**` routes return a `DryRunDescriptor` carrying the
  exact `message_hex` the browser must sign. Same inputs as the submit
  routes, minus the signature.
- **No admin role, no bearer token, no access gates.** Every route is
  open — the on-chain program is the permission boundary (proposer/
  approver bitmaps, thresholds, timelocks, ownership locks). The
  relayer's sponsored-gas keypair is a budget, not authorization. Abuse
  is contained by a per-pubkey token-bucket rate limiter (default 30
  submits / 60s, tunable via
  `CLEAR_MSIG_RATE_LIMIT_{WINDOW_SECS,MAX_PER_WINDOW}`).
- Per-invocation structured JSON logs emit `(subcommand, dry_run,
  actor_prefix, elapsed_ms, outcome)`; `RUST_LOG=info` surfaces the
  full request/response lifecycle.
- `/memberships` uses memcmp filters at offset 0 to narrow
  `getProgramAccounts` to wallets (disc=1) and intents (disc=2)
  separately.
- `GET /wallets/{name}/proposals/{proposal}/execute/stream` spawns the
  CLI and emits `progress` SSE events for each stderr line, then a
  final `done` event carrying the JSON result. Feeds the Phase 5.5
  live signing-pipeline UI.
- Back-compat shims in `frontend/src/lib/api/endpoints.ts` keep
  `useIntentWorkflow` / `useProposalWorkflow` compiling against the new
  routes until Phase 5 rewrites them for the full `signMessage` flow.

Everything below is the original plan; each sub-task now has code
behind it.

**Goal (original):** backend becomes a thin pre-signed-payload relayer.
No user-facing signing. Keep admin ops (DKG, add-chain, ika_sign,
execute-local) on the backend's payer keypair.

### 2.1 New request shapes for sign-requiring routes

**What:** Replace `AddIntentRequest`, `RemoveIntentRequest`,
`UpdateIntentRequest`, `CreateProposalRequest`, `ApproveCancelRequest`
in `backend-api/src/main.rs` with the pre-signed variants:

```rust
#[derive(Deserialize)]
struct SignedProposeRequest {
    intent_index: u8,
    params_data_hex: String,
    expiry: i64,
    proposer_pubkey_b58: String,
    signature_hex: String,
}

#[derive(Deserialize)]
struct SignedApproveCancelRequest {
    expiry: i64,
    approver_pubkey_b58: String,
    signature_hex: String,
}

// Intent add/remove/update: same shape as SignedProposeRequest plus
// governance for the *new* intent's definition
#[derive(Deserialize)]
struct SignedIntentAddRequest {
    definition: serde_json::Value,    // the intent JSON (built client-side)
    proposer_pubkey_b58: String,
    signature_hex: String,
    expiry: i64,
}
```

**Why:** Eliminates the backend's need to own user private keys.

**Where:** `backend-api/src/main.rs` — request structs + their route handlers.

### 2.2 Route handlers relay pre-signed bytes

**What:** Every sign-requiring handler calls the CLI with:

```
clear-msig \
  --signer-pubkey <pubkey_b58> \
  --signature <signature_hex> \
  --params-data <hex> \
  <subcommand> <args>
```

**Why:** Zero trust crossings. Backend is now a pure relayer.

**Where:** All handlers in `backend-api/src/main.rs` that previously built
`--param key=value` args need to just forward `--params-data <hex>`.

**Acceptance:** `curl -X POST` with the new body shape produces an on-chain
tx signed by `<pubkey_b58>` — verifiable by reading the Proposal account's
`proposer` field.

### 2.3 Rate limiting

**What:** Add `tower-governor` or a simple `HashMap<Pubkey, (count, window)>`
rate limiter, keyed by `proposer_pubkey_b58`. Reject > 30 submits/min.

**Why:** You're paying gas. Anyone with a valid signature can spam the
relayer. Rate limit by identity, not by IP.

**Where:** New file `backend-api/src/rate_limit.rs`, mounted as tower
middleware.

**Acceptance:** 31st rapid-fire submit returns HTTP 429.

### 2.4 Keep `CLEAR_MSIG_SIGNER` as the bootstrap payer only

**What:** The CLI's global `--signer` fallback (filesystem keypair) is
used only by ops that on-chain don't require an ed25519 multisig signature:
`wallet create`, `wallet add-chain`. Every other route goes through
`--signer-pubkey` + `--signature` (pre-signed). The backend injects the
filesystem signer via `CliRunner.base_args` for every CLI invocation —
the CLI ignores it whenever pre-signed flags are present, so there's no
ambiguity.

**Why:** `wallet create` and `add-chain` are bootstrap ops that *create*
the proposer/approver list. There's no meaningful signer to pre-sign as
yet. They stay open (any user can create a wallet or bind a chain),
paid by the backend's sponsored-gas keypair, rate-limited to prevent
abuse. No bearer token, no admin role — rate-limit is the abuse control.

### 2.5 Reshape `/memberships` to use memcmp filters — or delete it

**What:** Option A: Replace the linear scan in `membership_lookup` with
`getProgramAccounts` + `{filters: [{memcmp: {offset: 0, bytes: <disc=2>}}]}`
for a much cheaper query (filter for Intent accounts only).

**Option B (recommended):** Delete the route and move the read to the browser
(Phase 4.2). Reduces backend surface.

**Why:** The current linear scan fetches ALL program accounts on every
request. Browser-direct is O(1) RPC calls.

**Where:** Remove `fn membership_lookup` and its route. Keep it if Option A.

### 2.6 No admin auth (deliberate)

**What:** There are no admin routes. Every route is open. Abuse is
controlled via per-pubkey rate limiting (§2.3). The backend's
sponsored-gas keypair is a budget, not a permission boundary.

**Why (policy decision):** A multisig treasury where the operator of the
relayer can gate specific actions isn't really a multisig — you've
replaced N-of-M ed25519 consensus with a single bearer token. For this
product, the on-chain program IS the permission boundary: it enforces
signer membership, thresholds, timelocks, and ownership locks. The
backend is a neutral relayer; it can be run by anyone, including the
user themselves via the "self-submit" toggle (Phase 5.8).

### 2.7 Structured logging

**What:** Add `tracing::info!` with (route, elapsed_ms, actor_pubkey_prefix,
outcome) for every route. Use `tracing-subscriber` JSON formatter.

**Why:** Ops story for post-hackathon. Cheap now, expensive later.

**Where:** Wrap each route in a tower layer or add manual spans.

**Acceptance:** `RUST_LOG=info` output shows structured JSON with request
correlation.

---

## 5. Phase 3 — Frontend `msig/` Library

**Goal:** a TypeScript library that produces byte-identical output to the
Rust on-chain program for anything the browser needs to sign or parse.

**Location:** `frontend/src/lib/msig/`

**Approach:** Each module has a corresponding `.test.ts` with golden
vectors generated by `clear-msig --dry-run` (from Phase 1.5). CI asserts
byte equality.

### 3.1 Hashes — `hash.ts`

**What:** Thin wrappers over `@noble/hashes`:

```ts
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';

export function sha256Bytes(data: Uint8Array): Uint8Array;
export function keccak256Bytes(data: Uint8Array): Uint8Array;
```

**Why:** Every message-building path uses one of these.

**Where:** `frontend/src/lib/msig/hash.ts`. Add dep `@noble/hashes`.

### 3.2 Datetime — `datetime.ts`

**What:** Howard Hinnant civil-date algorithm, byte-identical to
`programs/clear-wallet/src/utils/datetime.rs::format_timestamp`. Returns
`"YYYY-MM-DD HH:MM:SS"`.

**Why:** The "expires 2030-01-01 00:00:00:" prefix must match on-chain
exactly or signature verification fails.

**Where:** `frontend/src/lib/msig/datetime.ts`.

**Acceptance:**
```ts
formatTimestamp(1000000000n) === '2001-09-09 01:46:40'
formatTimestamp(1900000000n) === '2030-03-17 06:26:40'
```
Match `cargo run -p clear-msig-cli -- config show` timestamp output for the
same Unix epoch.

### 3.3 Offchain wrapping — `offchain.ts`

**What:** Prepend `\xffsolana offchain || version(1=0) || format(1=0) ||
len_le(2)` to a message body. 20-byte header.

```ts
export const OFFCHAIN_DOMAIN = new Uint8Array([
  0xff, 0x73, 0x6f, 0x6c, 0x61, 0x6e, 0x61, 0x20,
  0x6f, 0x66, 0x66, 0x63, 0x68, 0x61, 0x69, 0x6e,
]);  // "\xffsolana offchain"

export function wrapOffchain(body: Uint8Array): Uint8Array;
```

**Where:** `frontend/src/lib/msig/offchain.ts`.

**Acceptance:** Matches `programs/clear-wallet/src/utils/message.rs::OFFCHAIN_SIGNING_DOMAIN`.

### 3.4 Param encoding — `encode.ts`

**What:** Given an intent account (decoded) and a `Record<string, string>`
of param values, encode them into the byte layout the on-chain program
expects (same algorithm as `cli/src/params.rs::encode_params`).

```ts
export function encodeParams(
  intent: IntentAccount,
  values: Record<string, string>
): Uint8Array;
```

Handles: `address` (b58), `u64`, `i64`, `string` (len prefix), `bool`,
`u8/u16/u32/u128`, `bytes20/bytes32` (hex).

**Where:** `frontend/src/lib/msig/encode.ts`.

**Acceptance:** 16+ golden-vector tests (one per param type) assert
byte-for-byte equality with CLI output.

### 3.5 Template rendering — `render.ts`

**What:** Port of `programs/clear-wallet/src/utils/message.rs::render_template`
(and its `cli/src/message.rs::render_template` mirror). Includes the
`{N:10^D}` decimal-shift spec.

```ts
export function renderTemplate(
  template: string,
  intent: IntentAccount,
  paramsData: Uint8Array,
): string;
```

**Where:** `frontend/src/lib/msig/render.ts`.

**Acceptance:** Golden vectors for each chain example in `examples/intents/`.
Specifically: `transfer {1} lamports to {0}` with `amount=1000000000` and
`destination=9abc...` should render byte-for-byte with the on-chain output.

### 3.6 Message building — `message.ts`

**What:** Top-level builder matching
`programs/clear-wallet/src/utils/message.rs::MessageBuilder::build_message_for_intent`.
Dispatch on `intent.intent_type`:

- `AddIntent (0)` → `"expires <ts>: <action> add intent definition_hash: <hex> | wallet: <name> proposal: <idx>"`
- `RemoveIntent (1)` → `"expires <ts>: <action> remove intent <index> | ..."`
- `UpdateIntent (2)` → `"expires <ts>: <action> update intent <idx> definition_hash: <hex> | ..."`
- `Custom (3)` → `"expires <ts>: <action> <rendered_template> | ..."`

Then `wrapOffchain(body)`.

```ts
export function buildSignableMessage(params: {
  action: 'propose' | 'approve' | 'cancel';
  expiry: bigint;
  walletName: string;
  proposalIndex: bigint;
  intent: IntentAccount;
  paramsData: Uint8Array;
}): Uint8Array;
```

**Where:** `frontend/src/lib/msig/message.ts`.

**Acceptance:** For each of the 5 test intents (add_sol, add_erc20, add_evm,
add_btc, remove_at_3), golden-vector assertion against CLI `--dry-run`
output.

### 3.7 Account parsing — `accounts.ts`

**What:** TypeScript mirrors of `cli/src/accounts.rs`:

```ts
export function parseWallet(data: Uint8Array): WalletAccount;
export function parseIntent(data: Uint8Array): IntentAccount;
export function parseProposal(data: Uint8Array): ProposalAccount;
export function parseIkaConfig(data: Uint8Array): IkaConfigAccount;
```

Byte layouts from `state/*.rs`.

**Where:** `frontend/src/lib/msig/accounts.ts`.

**Acceptance:** Decoding a real devnet account matches the CLI's
`wallet show` / `intent list` / `proposal show` output field-for-field.

### 3.8 PDA derivations — `pda.ts`

**What:** Browser-side PDA derivations (port of
`programs/clear-wallet/client/src/pda.rs`):

```ts
export function findWalletPda(name: string, programId: PublicKey): [PublicKey, number];
export function findVaultPda(wallet: PublicKey, programId: PublicKey): [PublicKey, number];
export function findIntentPda(wallet: PublicKey, index: number, programId: PublicKey): [PublicKey, number];
export function findProposalPda(intent: PublicKey, index: bigint, programId: PublicKey): [PublicKey, number];
export function findIkaConfigPda(wallet: PublicKey, chainKind: number, programId: PublicKey): [PublicKey, number];
```

**Where:** `frontend/src/lib/msig/pda.ts`. Use `PublicKey.findProgramAddressSync`.

**Acceptance:** Matches CLI-derived PDAs for the same inputs.

### 3.9 Golden-vector test harness

**What:** Add a `frontend/scripts/golden-vectors.ts` script that calls `cargo
run -p clear-msig-cli --dry-run` with N scenarios, writes the output to
`frontend/src/lib/msig/__fixtures__/*.json`, and each TS test loads the
fixture and asserts match.

**Why:** Single source of truth. Rust is canonical; TS follows.

**Where:** `frontend/scripts/golden-vectors.ts`, `__fixtures__/`.

**Acceptance:** `npm run test:msig` passes.

---

## 6. Phase 4 — Frontend Direct-From-Chain Reads

**Goal:** the frontend reads wallets, intents, proposals, and memberships
directly from Solana RPC. Backend relayer is only used for writes.

### 4.1 Chain client — `src/lib/chain/client.ts`

**What:** Thin wrapper around `@solana/web3.js` `Connection` configured from
`appConfig.preAlpha.solanaRpcUrl`.

```ts
export const solanaConnection = new Connection(appConfig.preAlpha.solanaRpcUrl, 'confirmed');
export const programId = new PublicKey('2jsLpMRZAJUJJ7weNhBJqVAgLjpngi6xTEPUbttmTUjA');
```

**Where:** `frontend/src/lib/chain/client.ts`.

### 4.2 Memberships — `src/lib/chain/memberships.ts`

**What:** `getProgramAccounts(programId, {...})` with:

```ts
// Filter for Intent accounts (discriminator=2) that contain the address
// in the proposers list.  The proposers Vec is at a fixed offset:
// disc(1) + wallet(32) + bump(1) + intent_index(1) + intent_type(1)
// + chain_kind(1) + approved(1) + ...(fixed fields)... + 4-byte len prefix

// We can't memcmp inside a Vec easily, so we do a lighter filter by
// discriminator and walk the Vec client-side.
filters: [
  { memcmp: { offset: 0, bytes: bs58.encode(new Uint8Array([2])) } },
]
```

Then for each returned intent, use `parseIntent` to check `proposers`/
`approvers` membership. Group by `wallet` field. Cross-reference wallet PDAs
(disc=1) to get the human name.

```ts
export async function listMemberships(address: PublicKey): Promise<Membership[]>;
```

**Where:** `frontend/src/lib/chain/memberships.ts`.

**Acceptance:** After adding the connected wallet as an approver to a
devnet multisig, `listMemberships` returns an entry with the correct wallet
name and roles.

### 4.3 Wallet / intent / proposal reads

**What:** Direct RPC reads via `connection.getAccountInfo` + `parseX`:

```ts
export async function getWallet(name: string): Promise<WalletAccount | null>;
export async function listIntents(walletPda: PublicKey): Promise<IntentAccount[]>;
export async function listProposals(walletPda: PublicKey): Promise<ProposalAccount[]>;
export async function getProposal(proposalPda: PublicKey): Promise<ProposalAccount | null>;
export async function listIkaConfigs(walletPda: PublicKey): Promise<IkaConfigAccount[]>;
```

**Where:** `frontend/src/lib/chain/wallets.ts`, `intents.ts`, `proposals.ts`,
`chains.ts`.

**Acceptance:** UI reads work with backend DOWN. Manual test:
`pkill clear-msig-backend`, refresh page, all reads still work.

### 4.4 Live updates via `onAccountChange`

**What:** For the currently selected proposal, subscribe to its account:

```ts
connection.onAccountChange(proposalPda, (account) => {
  queryClient.setQueryData(['proposal', proposalPda.toBase58()], parseProposal(account.data));
});
```

**Why:** Approval bitmap lights up in real-time when another signer
submits.

**Where:** New hook `frontend/src/lib/hooks/useProposalSubscription.ts`.

**Acceptance:** Open two browser tabs as different signers; one approves;
the other sees the bitmap animate within 2s with no manual refresh.

### 4.5 Replace hook internals

**What:** `useWalletWorkflow`, `useIntentWorkflow`, `useProposalWorkflow` —
switch their GETs from backend calls to direct RPC reads using the new
`chain/` lib. POSTs still go to the backend (for relayed submission).

**Where:** `frontend/src/lib/hooks/*.ts`.

**Acceptance:** `grep -R "apiRequest" frontend/src/lib/hooks` returns only
mutation calls, no query calls.

---

## 7. Phase 5 — Frontend Write Flows (Real Multisig)

**Goal:** every write action is signed by the user's browser wallet.

### 5.1 `useSignWithWallet` hook

**What:** Wrap `wallet.signMessage` with error handling:

```ts
export function useSignWithWallet() {
  const { signMessage, publicKey, connected } = useWallet();

  return useMutation({
    mutationFn: async (bytes: Uint8Array) => {
      if (!signMessage || !publicKey) throw new Error('wallet does not support signMessage');
      const sig = await signMessage(bytes);
      return { pubkey: publicKey.toBase58(), signatureHex: toHex(sig) };
    },
  });
}
```

**Why:** Single entry point; all flows use this.

**Where:** `frontend/src/lib/hooks/useSignWithWallet.ts`.

### 5.2 CreateWalletCard rewrite

**What:** Keep the 3-step form (org / purpose / signers). Change the submit
handler:

1. Validate addresses.
2. POST to `/wallets` with `{name, proposers, approvers, threshold,
   cancellation_threshold, timelock}`. No signature needed for wallet
   creation (the on-chain `create_wallet` only requires the payer signs the
   Solana tx; approver/proposer addresses are just recorded).
3. Fire invite emails **in the background** (don't await them in the
   critical path — if SMTP fails, wallet is already created).
4. Navigate to `/app/wallet/{walletName}` on success.

**Why:** Current flow awaits emails in the mutation → if SMTP fails you lose
the transaction reference. Bad UX.

**Where:** `frontend/src/components/wallet/CreateWalletCard.tsx`.

**Acceptance:**
- On success: toast "Multisig 'treasury' created on Solana devnet" with
  tx-signature link to explorer.
- Emails either succeed silently or log a warning. Failure doesn't break
  the flow.

### 5.3 IntentCard rewrite — "Add Intent" flow

**What:** Major rewrite. Replace text inputs with a **typed intent builder**:

1. User picks a chain from a card grid (Solana, EVM 1559, ERC-20, BTC P2WPKH, Zcash transparent). Matches `ChainKind::from_u8` on-chain.
2. User picks a template: "Transfer SOL", "Transfer ETH", "Transfer ERC-20", "Transfer BTC", "Transfer ZEC". SPL tokens are not a separate chain — they ride the same EVM-ERC-20 path in reverse (post-hackathon; note it in the UI as "coming soon").
3. Typed form for that template's params: addresses, amounts with decimals, etc.
4. Click "Preview":
   - Build intent JSON client-side
   - Build the AddIntent message (sha256 of the serialized intent body + offchain header)
   - Show both panes: rendered description + exact hex bytes
5. Click "Sign with Wallet":
   - `signMessage(bytes)`
   - POST to `/wallets/{name}/intents/add` with `{definition, proposer_pubkey, signature, expiry}`
6. Toast on success; new intent appears via `useProposalSubscription` on the new AddIntent proposal.

**Why:** Typed forms eliminate the "paste JSON path" DX. Previews prove
clear-signing. This is demo-worthy.

**Where:**
- New `frontend/src/components/intents/IntentChainPicker.tsx`
- New `frontend/src/components/intents/IntentTemplateForm.tsx` (dispatch by chain)
- New `frontend/src/components/intents/IntentPreview.tsx` (the "what your Ledger sees" pane)
- Rewrite `frontend/src/components/intents/IntentCard.tsx`

**Acceptance:**
- Starting from an empty wallet, the user can pick "EVM 1559 → Transfer ETH", fill a Sepolia recipient, set gas defaults, click Sign, Ledger displays the intent summary, user confirms, intent proposal lands on-chain, and it shows in the intents list within 3s.

### 5.4 ProposalCard rewrite — "Create Proposal"

**What:**

1. User selects a custom intent (index 3+) from a dropdown populated from
   `listIntents(wallet)`.
2. Form renders from the intent's `params`, one field per param with the
   right input type (address picker, number input with decimal hint,
   textarea for data).
3. Live preview of the rendered template above the form ("send 0.0001 ETH to
   0x...Dead (nonce 0)").
4. Click Sign → `buildSignableMessage('propose', ...)` →
   `wallet.signMessage` → POST to `/wallets/{name}/proposals`.

**Where:** rewrite `frontend/src/components/proposals/ProposalCard.tsx` +
new subcomponents `TypedParamInput.tsx`, `ProposalPreview.tsx`,
`ApprovalBitmap.tsx`.

**Acceptance:**
- `{2:10^18}` intent renders "0.0001" for `value_wei=100000000000000`.
- The signed message body shown in preview is byte-identical to what the
  CLI prints for the same inputs via `--dry-run`.

### 5.5 Proposal details page — `/app/proposals/[proposal]`

**What:** Deep-link-addressable page showing one proposal:

```
┌─────────────────────────────────────────────────────────┐
│  proposal address: 9abc...xyz              [copy]       │
│  status: Approved (2/3)                                 │
│                                                         │
│  ┌─ signed message (your Ledger will show this) ─┐      │
│  │ expires 2030-01-01 00:00:00: approve send     │      │
│  │ 0.0001 ETH to 0xdEaD... | wallet: treasury    │      │
│  │ proposal: 42                                  │      │
│  └───────────────────────────────────────────────┘      │
│                                                         │
│  approvals:  ● ● ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○          │
│              alice, bob pending: carol                  │
│                                                         │
│  [ Approve ]  [ Cancel ]  [ Execute & Broadcast ]       │
│                                                         │
│  chain: EVM 1559 (Sepolia)                              │
│  preimage hash: 0x…                                     │
│  expected sig: ECDSA Secp256k1 + Keccak-256             │
└─────────────────────────────────────────────────────────┘
```

Approve / cancel follow the same signMessage → relay flow. Execute is
permissionless post-threshold; button is enabled for anyone when
`approval_count >= threshold`.

**Why:** Shareable URL + clear per-proposal focus = demo centerpiece.

**Where:**
- `frontend/src/app/app/proposals/[proposal]/page.tsx`
- `frontend/src/components/proposals/ProposalDetail.tsx`

**Acceptance:**
- Paste a proposal PDA into the URL, page loads with correct state.
- Approval bitmap updates live when another signer approves in a different tab.

### 5.6 Wallet details + chain bindings viewer

**What:** New page `/app/wallet/[name]` showing:

- Wallet PDA, vault PDA, proposal_index, intent_index
- Chain bindings (dWallet + derived addresses for EVM + BTC) —
  use `listIkaConfigs(walletPda)` + derive EVM address via `keccak256` +
  BTC addresses via `hash160 + bech32`
- Members (combined proposers/approvers from intents 0-2)
- Balance per chain (query Solana balance for vault, EVM balance via JSON-RPC,
  BTC balance via Esplora)

**Why:** This is currently data the backend returns but the UI throws away.
Surfacing it makes the treasury feel real.

**Where:**
- `frontend/src/app/app/wallet/[name]/page.tsx`
- `frontend/src/components/wallet/ChainBindingList.tsx`
- `frontend/src/components/wallet/MemberList.tsx`
- `frontend/src/components/wallet/BalanceGrid.tsx`

**Acceptance:**
- For a wallet with EVM chain bound, the UI shows the computed Sepolia
  address and live ETH balance.
- For a wallet with BTC P2WPKH bound, shows both mainnet (`bc1q...`) and
  testnet (`tb1q...`) addresses.

### 5.7 Audit trail page — `/app/wallet/[name]/audit`

**What:** Table of every executed proposal for this wallet:

| When | Action | Params | Approvers | Solana tx | Remote tx |
|---|---|---|---|---|---|
| 2026-04-15 18:02 | "send 0.0001 ETH" | to=0xDead, nonce=0 | alice, bob | sol `...` | sepolia `...` |

Every cell is a link to the explorer. Filter by chain, date range, approver.

**Why:** The "receipts that Bybit didn't have" narrative. This page alone
might win the hackathon.

**Where:**
- `frontend/src/app/app/wallet/[name]/audit/page.tsx`
- `frontend/src/components/wallet/AuditTrail.tsx`
- Reads: `listProposals(wallet)`, filter status=Executed. For each, read
  `getTransaction(proposal.last_tx_sig)` for the Solana signature; for ika-
  signed ones, parse the `MessageApproval` PDA for the remote tx hash.

**Acceptance:** After one full demo cycle, the audit page shows each step
with clickable explorer links.

### 5.8 "Self-submit" fallback

**What:** Next to every Sign button, a "Submit from my own wallet" toggle.
If enabled:
1. User signs the multisig message as before.
2. Frontend builds the Solana tx envelope itself (no relayer).
3. Signs the envelope with the browser wallet (`signTransaction`).
4. Submits directly to Solana RPC.

**Why:** Proves the relayer is optional. If judges ask "what if your backend
is down?" → flip the toggle, everything still works.

**Where:** `frontend/src/lib/tx/buildPropose.ts` +
`frontend/src/components/ui/SubmitToggle.tsx`.

**Acceptance:** With backend stopped, toggle on, full propose/approve/execute
flow completes.

### 5.9 Toast / error UX

**What:** Use `react-hot-toast` (or build a simple toast context). Every
mutation shows:

- Loading toast: "Signing message…" / "Broadcasting to Solana…" / "Waiting for dWallet signature…"
- Success toast: "Approved. 2/3 signatures collected." with explorer link.
- Error toast: human-readable stderr from the backend envelope; clickable
  "show technical details" expands to full error JSON.

**Why:** Current UX shows `String(error)` inline; that's hostile.

**Where:** New `frontend/src/components/ui/Toast.tsx`, wire into all mutations.

---

## 8. Phase 6 — Landing Page & Design Polish

**Goal:** a landing page so tight that judges remember the product before
they open the code.

### 6.1 Design tokens

**What:** Establish a minimal, brand-consistent design system in
`tailwind.config.ts`:

```ts
colors: {
  background: '#fafaf9',        // warm off-white (less clinical than pure white)
  surface:    '#0a0a0a',        // near-black for dark cards
  'brand-green':       '#14F195',  // Solana green
  'brand-green-soft':  '#14F195',
  'brand-emerald':     '#10b981',
  'brand-white':       '#f8fafc',
  'text-muted':        '#64748b',
  'text-strong':       '#0f172a',
},
fontFamily: {
  sans: ['var(--font-inter)', 'sans-serif'],
  mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
  display: ['var(--font-space-grotesk)', 'sans-serif'],  // hero headlines
},
boxShadow: {
  glow: '0 0 30px rgba(20, 241, 149, 0.35)',
  'glow-strong': '0 0 60px rgba(20, 241, 149, 0.5)',
  'card-shadow': '0 10px 40px -10px rgba(0, 0, 0, 0.3)',
},
```

Add Space Grotesk + JetBrains Mono from Google Fonts via `next/font`.

**Where:** `frontend/tailwind.config.ts`, `frontend/src/app/layout.tsx`.

### 6.2 Landing page structure

**What:** Rewrite `frontend/src/app/page.tsx` with these sections,
top-to-bottom:

1. **Hero** — one sentence, one CTA, one demo.
   - Headline: "Sign intents. Not hex."
   - Sub: "A Solana multisig where every signature is a sentence your Ledger can read. One policy controls Ethereum, Bitcoin, and Solana treasuries."
   - CTA: `Connect wallet →` (WalletMultiButton styled as primary).
   - Right pane: animated terminal that cycles through:
     ```
     > sign?
     expires 2026-04-20 18:00: approve transfer 0.5 ETH to 0x71C...A23 | wallet: treasury proposal: 42
     [Y/n] ▍
     ```
   - GSAP timeline types the message then a green checkmark fades in.

2. **The problem** — three cards:
   - "Bybit: $1.4B lost because signers trusted a UI"
   - "Drift: admin keys compromised via blind-signed approvals"
   - "You: still signing `0x8f2a...` and praying"
   - Subtext: "Hardware wallets show the hash, not the action. You have no idea what you're approving."

3. **The fix** — two-column split showing Before/After:
   - Before (red-tinted terminal): blob of hex bytes.
   - After (green-tinted terminal): the human-readable message with labeled fields.
   - Animated arrow between them with `framer-motion`.

4. **How it works** — 4-step horizontal flow with scroll-triggered
   animation (use existing GSAP ScrollTrigger setup):
   1. Propose — one signer drafts an intent.
   2. Approve — signers sign a human-readable string.
   3. Execute — on-chain program verifies every sig, drives Ika dWallet.
   4. Broadcast — MPC network signs, tx lands on destination chain.

5. **Chains** — grid of 4 cards (Solana, Ethereum, Bitcoin, ERC-20 tokens).
   Each has a chain logo, the signature scheme, and an example human-readable
   message rendered in it.

6. **Architecture** — single compact diagram matching the one in this
   document (browser / relayer / on-chain, with trust boundaries labeled).
   Subtle parallax on scroll.

7. **Live on-chain stats** (bonus, if time permits) — query devnet for:
   - "N wallets created"
   - "M proposals executed"
   - "T ETH transferred via Ika"
   - Updates every 30s.

8. **Team / open source** — links: GitHub, blog post, Ika, Quasar.

9. **Footer** — compact, no fluff.

**Where:** rewrite `frontend/src/app/page.tsx`. Extract each section into
its own component under `frontend/src/components/landing/`.

**Principles:**
- Max 8 visible lines of copy per section.
- No "Lorem ipsum"-style filler paragraphs.
- Every animation has a purpose; nothing moves that doesn't communicate.
- `prefers-reduced-motion` disables non-essential animations.

### 6.3 Animations

**What:** Concrete animation choices:

- **Framer-motion** for transitional UI (cards entering, tab switches, modal open/close, bitmap dot lighting). Use `whileInView` for scroll-enter effects.
- **GSAP ScrollTrigger** for the landing-page "how it works" flow and the hero terminal type-in. Use `prefers-reduced-motion` gate.
- **CSS keyframes** for persistent decorative elements (pulse rings, glow pulses). Don't use framer-motion for infinite animations — it's expensive.
- **@react-three/fiber**: KEEP the landing-page blob but lazy-load it
  (`next/dynamic` with `ssr: false`). Drop it from non-landing pages.

**Where:** Keep existing libs; just discipline the usage.

### 6.4 Assets

**What:** Add the following images to `frontend/public/assets/`:

- `solana.svg` (already have PNG; SVG for crispness)
- `ethereum.svg`
- `bitcoin.svg`
- `ledger.svg` (for the "Ledger-first" panels)
- `ika.svg` (Ika logo)
- `hero-pattern.svg` (subtle grid/constellation background, inline or file)

Source from official brand kits. All under 20 KB each.

Do NOT use random photos of computers/locks — those make the brand look
stock. Icon/diagram style only.

**Where:** `frontend/public/assets/`.

### 6.5 Typography pass

**What:**
- Display (hero, section H1s): Space Grotesk 700, tight tracking, tight leading.
- Body: Inter 400, loose leading (1.6).
- Monospace (hex previews, addresses, CLI blocks): JetBrains Mono.

Consistent type scale: 12 / 14 / 16 / 18 / 24 / 32 / 48 / 64 px (use Tailwind `text-xs` through `text-8xl`).

**Where:** `frontend/src/app/layout.tsx` (font loading), components.

### 6.6 Responsive

**What:** Every page must work at 360px wide (smallest common phone). Test
matrix: 360 / 414 / 768 / 1024 / 1440 / 1920. No horizontal scroll anywhere.

- Landing: stacks vertically below 1024px.
- App pages: side nav → bottom tab bar below 768px (already done).
- Forms: single column below 640px.
- Cards: full-width below 480px.

**Where:** Global responsive audit. Use Tailwind `sm:/md:/lg:` consistently.

**Acceptance:** Chrome DevTools device toolbar — all pages render cleanly at
every preset from iPhone SE up to 4K.

### 6.7 Loading, empty, error states

**What:** Every query + mutation has three states:

- **Loading:** skeleton shimmer (not spinner) — dimensions match the final content.
- **Empty:** an illustration + one-line message + primary action. Example: "No multisigs yet. [Create one →]"
- **Error:** a toast for transient errors; an inline error state for terminal errors with a retry button.

**Where:** New `frontend/src/components/ui/{Skeleton,EmptyState,ErrorState}.tsx`. Use across all workflow cards.

### 6.8 Accessibility pass

**What:**
- All interactive elements keyboard-navigable; visible `:focus-visible` ring.
- `aria-label` on icon-only buttons.
- Contrast ratio ≥ 4.5:1 for body text (use a contrast checker).
- No motion-only signifiers (add text too).

**Where:** Audit pass across all components.

**Acceptance:** Lighthouse accessibility score ≥ 95 on all pages.

### 6.9 Performance

**What:**
- Lazy-load `@react-three/fiber` landing-page blob.
- Lazy-load GSAP ScrollTrigger.
- Use `next/image` for assets.
- Code-split `/app/*` pages from `/` with dynamic imports where useful.
- Preconnect to devnet RPC in `<head>`.

**Where:** `frontend/src/app/layout.tsx`, `next.config.ts`.

**Acceptance:** Lighthouse performance ≥ 85 on the landing page. First
Contentful Paint < 1.5s on a 4G connection (Chrome throttled).

### 6.10 Metadata + social previews

**What:** OpenGraph + Twitter card images (1200x630 PNG).
- Title: "Clear-MSIG — Sign intents, not hex"
- Description: "A Solana multisig where every signature is human-readable. Cross-chain custody via Ika MPC."
- `frontend/public/og.png`

**Where:** `frontend/src/app/layout.tsx` metadata.

---

## 9. Phase 7 — Testing & Hardening

### 7.1 On-chain tests — run clean

**What:** After Phase 0.1 fix, verify `cargo test -p clear-wallet tests::`
runs all tests.

**Acceptance:** All non-ignored tests green on CI.

### 7.2 Frontend unit tests

**What:** Vitest + React Testing Library covering:
- `frontend/src/lib/msig/*.test.ts` — golden-vector byte-match tests.
- `frontend/src/lib/chain/memberships.test.ts` — parser correctness on known
  on-chain data (record/replay).
- `frontend/src/components/proposals/ProposalPreview.test.tsx` — renders
  correct string for each intent type.

**Where:** `frontend/src/**/*.test.ts(x)`.

**Acceptance:** `npm run test` passes. Coverage on `lib/msig/` ≥ 90%.

### 7.3 E2E smoke tests

**What:** Playwright test that:
1. Starts devnet RPC (mock) + backend + frontend.
2. Connects a fake wallet adapter with a known keypair.
3. Creates a wallet, adds a Solana intent, proposes, approves, executes.
4. Asserts the proposal shows `status: Executed`.

**Where:** `frontend/tests/e2e/smoke.spec.ts`. Add `@solana/web3.js` mock
wallet for CI.

**Acceptance:** `npm run test:e2e` passes locally and in CI.

### 7.4 Full devnet smoke script

**What:** Shell script `scripts/demo/full-flow.sh` that:
1. Deploys program to devnet (if not deployed).
2. Creates a wallet.
3. Adds an EVM intent.
4. Creates a proposal.
5. Approves 2-of-3.
6. Executes with broadcast to Sepolia.
7. Prints every step's tx hash + explorer URL.

**Where:** `scripts/demo/full-flow.sh`.

**Acceptance:** Run end-to-end, writes `docs/demo-run-YYYYMMDD.md` with
every tx link.

### 7.5 Frontend lint & type-check

**What:** `npm run lint && npm run typecheck` must pass. Fix all existing
`any`s, missing deps, unused imports.

**Where:** `frontend/**/*`.

**Acceptance:** Zero errors, zero warnings.

### 7.6 README polish

**What:** The chain table is already accurate (all 5 chains are built).
Enhancements only:

- Add a "Why this matters" section quoting Bybit / Drift.
- Add the section 1 architecture diagram.
- Add a "Known limitations" section covering the Ika pre-alpha mock (single
  mock signer, not distributed MPC) and that Solana intents use a durable
  nonce account whose authority is the dWallet pubkey.
- Double-check every example command against the current CLI flags.
- Link to the demo video.

**Where:** `README.md`.

**Acceptance:** A first-time reader can go from clone to devnet execution in
under 10 minutes using only the README.

### 7.7 Operator runbook

**What:** Update `PRE_ALPHA_OPERATIONS_RUNBOOK.md` with:
- Step-by-step deploy to devnet.
- Environment variables reference.
- Common errors + fixes.
- Rollback procedure.

**Where:** `PRE_ALPHA_OPERATIONS_RUNBOOK.md`.

### 7.8 Security notes

**What:** Create `SECURITY.md`:
- Known limitations of Ika pre-alpha (mock signer, not real MPC).
- Trust model (browser / relayer / on-chain).
- Threat scenarios (compromised relayer, malicious signer, RPC tampering) and mitigations.
- What we DON'T claim (not audited, not production).

**Where:** `SECURITY.md`.

---

## 10. Phase 8 — Demo Prep

### 8.1 Scripted demo path

**What:** A 3-minute demo with voice-over:

1. [0:00] Landing page. "Every signer in history has been signing blind." (Bybit quote)
2. [0:15] Connect wallet (Phantom).
3. [0:25] Create treasury with 3 signers, 2/3 threshold.
4. [0:40] Add EVM intent ("Transfer ETH to any address"). Show typed form + preview.
5. [0:55] Sign with wallet. Show the exact message on screen.
6. [1:05] Second browser tab as a different signer. Approve same proposal. Watch bitmap animate.
7. [1:20] Execute. Watch 4-step Ika flow progress (Solana sign → gRPC presign → gRPC sign → Sepolia broadcast).
8. [1:45] Sepolia explorer showing the received tx.
9. [2:00] Audit trail page. Point at the receipt row.
10. [2:15] "This never happens with opaque hashes." fade to logo.

**Where:** Record with OBS. 1080p 30fps.

**Acceptance:** One clean take < 3:30.

### 8.2 Pitch deck

**What:** 10 slides max.

1. Title + tagline.
2. Problem (Bybit $1.4B, Drift).
3. Root cause (blind signing).
4. Solution (clear-sign multisig).
5. Demo screenshot (or GIF).
6. How it works (diagram).
7. Cross-chain: one policy → SOL/ETH/BTC.
8. Architecture (trust zones).
9. What's next (audit, mainnet, multi-sig-as-a-service).
10. Contact + repo links.

**Where:** Google Slides or Keynote. Export to PDF + commit to
`docs/pitch.pdf`.

### 8.3 Prepared judge answers

**What:** `docs/FAQ.md` covering:

- "What if your backend goes down?" → Self-submit toggle demo.
- "What if Ika pre-alpha has a bug?" → Shows ownership lock + error surfaces.
- "What if an approver loses their wallet?" → Can still propose a UpdateIntent to swap them out.
- "How do you prevent a relayer from replacing params?" → Signature covers params_data hash.
- "What's the gas story?" → Relayer pays today; user-pays mode toggle.
- "Why Ika vs native bridges?" → Custody without wrapping. dWallet pubkey IS the address.

**Where:** `docs/FAQ.md`.

### 8.4 Landing page final polish

**What:** Perf + a11y + spelling sweep. Make sure mobile hero is clean, not
squished. Dark mode? Skip (one style, execute it well).

### 8.5 Submit

**What:** Hackathon-specific submission form. Attach:
- Demo video link.
- GitHub URL.
- Live deployment URL.
- One-pager PDF.
- Deck PDF.
- 30-second elevator pitch paragraph.

---

## 11. Cross-cutting conventions

### 11.1 File layout

```
programs/clear-wallet/         unchanged (Rust on-chain)
cli/                           minor changes (pre-signed mode)
backend-api/                   rewrite routes + rate-limit + logging
frontend/src/
  app/
    page.tsx                   landing
    app/
      layout.tsx
      wallet/
        page.tsx               memberships + create
        [name]/
          page.tsx              wallet details + chain bindings
          audit/page.tsx        audit trail
      intents/
        page.tsx               intent governance
      proposals/
        page.tsx               proposal list
        [proposal]/page.tsx    single-proposal deep link
    api/
      invitations/route.ts     (unchanged)
  components/
    landing/                   landing sections
    wallet/                    CreateWalletCard, WalletDetail, ChainBindingList, etc.
    intents/                   IntentChainPicker, IntentTemplateForm, IntentPreview
    proposals/                 ProposalCard, ProposalDetail, ApprovalBitmap, ProposalPreview
    ui/                        Toast, Skeleton, EmptyState, ErrorState, SubmitToggle, CardShell, ResponseViewer
    layout/                    HeaderBar, AppNav, ConstellationBackground
    animations/                landing-specific heavy animations
  lib/
    msig/                      byte-exact TS port (Phase 3)
    chain/                     direct RPC client (Phase 4)
    hooks/                     useSignWithWallet, useWalletWorkflow, useIntentWorkflow, useProposalWorkflow, useProposalSubscription
    api/                       thin relayer client
    tx/                        self-submit tx builders (5.8)
    config.ts
    solana/cluster.ts
e2e/                           devnet integration test (fixed in 0.3)
scripts/
  prealpha/                    (unchanged)
  demo/
    full-flow.sh               (7.4)
```

### 11.2 Coding conventions

**Rust:**
- `cargo fmt` + `cargo clippy --workspace --all-targets` clean.
- `#[allow(dead_code)]` only on explicitly-future-use items with a comment.

**TypeScript:**
- Strict mode on.
- No `any` unless wrapping an external untyped lib.
- Prefer `type` over `interface`.
- Functional components; no class components.
- One component per file unless tightly coupled.
- File names: `PascalCase.tsx` for components, `camelCase.ts` for libs.

### 11.3 Git discipline

- One branch per phase. Squash-merge to main.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Each commit must build + tests pass.
- Tag milestones: `v0.1.0-phase0-unblocked`, `v0.2.0-pre-signed`, etc.

### 11.4 Environments

**Dev:** Solana devnet + Ika pre-alpha + local backend + `npm run dev`.
**Demo:** Same as dev, but run on a public-IP VPS or fly.io/render/railway.
**Production:** Don't. This is pre-alpha. Add a banner everywhere: "Devnet
only. Do not use for real funds."

### 11.5 Secrets

- Backend payer keypair: ENV only, never committed.
- SMTP: ENV only.
- Admin token: ENV only.
- Frontend `NEXT_PUBLIC_*`: these ARE public; no secrets allowed.

---

## 12. Work estimate

| Phase | Scope | Effort | Day |
|---|---|---|---|
| 0 | Unblocks + devnet deploy | 4h | Day 1 AM |
| 1 | CLI pre-signed mode | 3h | Day 1 PM |
| 2 | Backend relayer rewrite | 4h | Day 1 late / Day 2 AM |
| 3 | `lib/msig/` + golden vectors | 6h | Day 2 AM/PM |
| 4 | Direct-from-chain reads | 4h | Day 2 PM |
| 5 | Frontend write flows (big) | 12h | Day 2 late / Day 3 full |
| 6 | Landing + polish | 8h | Day 3 late / Day 4 AM |
| 7 | Testing + docs | 4h | Day 4 AM |
| 8 | Demo prep | 3h | Day 4 PM |

Total: ~48 hours over 4 days. Single operator. Tighten any phase via
sub-agent delegation for isolated tasks (e.g. landing sections, TS porting
of individual modules).

---

## 13. Task delegation to sub-agents

Suggestions for tasks to parallelize via `Agent` tool:

- **Phase 3.1-3.8 (msig/ TS library):** one sub-agent per module, each given the Rust source as input + golden vectors. Review before merge.
- **Phase 6.2 (landing sections):** one sub-agent per section. Provide the section brief; review design consistency after.
- **Phase 7.2 (frontend unit tests):** sub-agent per test file. Share the golden-vector fixtures.

Do NOT delegate:
- Architecture decisions.
- Anything that touches the on-chain program.
- The `--pre-signed` flow through the CLI (single trust-critical path).
- Design system token selection.

---

## 14. Done-definition — the "can we submit?" checklist

A full run-through without human intervention:

- [ ] `cargo build --workspace` clean.
- [ ] `cargo test -p clear-wallet` green.
- [ ] `cargo run -p e2e-clear-msig-ika -- <DWALLET>` green against devnet.
- [ ] `npm run lint && npm run typecheck && npm run test` green.
- [ ] `npm run test:e2e` (Playwright) green.
- [ ] `scripts/demo/full-flow.sh` produces a Sepolia tx and an artifact markdown.
- [ ] `GET /health` 200. `GET /memberships` returns correct data for the demo wallet.
- [ ] Landing page loads < 1.5s FCP on throttled 4G.
- [ ] Lighthouse: perf ≥ 85, a11y ≥ 95, best practices ≥ 95, SEO ≥ 90.
- [ ] Mobile responsive from 360px up.
- [ ] Demo video recorded in one take, < 3:30.
- [ ] README quickstart works on a clean clone.
- [ ] No private keys in git.
- [ ] No `console.log` / `dbg!` / `println!` debug statements in production code paths.

When every checkbox is ticked, we submit.

---

## 15. Open questions

1. ~~**Do we scope in Zcash?**~~ **Resolved during Phase 0**: Zcash is already implemented in the code. `programs/clear-wallet/src/chains/zcash.rs` builds the ZIP-243 preimage with BLAKE2b-256 personalised `ZcashSigHash \|\| branch_id`; `cli/src/chains/zcash.rs` handles broadcast. Keep it in scope. Phase 3.5 (TS template renderer) and Phase 5.3 (typed form) must include Zcash.

2. ~~**Do we reframe Solana-via-Ika?**~~ **Resolved during Phase 0**: the code already does Solana via Ika Curve25519/EdDSA dWallets — not the old local-vault CPI. The dWallet pubkey IS the Solana address. No durable-nonce dance, no vault PDA. The README's claim is accurate.

3. **Ika pre-alpha mock constraint**: the deployed mock may still be single-signer rather than distributed MPC. All chain signing paths should work against it end-to-end at the pinned `3bd7945e` commit, but real MPC guarantees only land in Alpha 1. **Action**: add a banner to the app ("Ika pre-alpha — mock signer, not production MPC") and a line in the README's "Known limitations" section. No architecture change.

4. **Do we add MetaMask-Snap as a Solana-wallet option?** Would let Ethereum-native users sign through their existing setup. **Recommendation: post-hackathon; Phantom+Solflare+Backpack covers the judges.**

5. **Do we do a live demo or a pre-recorded video?** Live demos break. **Recommendation: pre-record + have a backup live environment ready.**

6. **Hosting for the demo?** Vercel for frontend, fly.io for backend. **Recommendation: yes; add to Phase 8.**

7. **Does the Ika pre-alpha mock accept secp256k1 ECDSA end-to-end?** The CLI's `signing_params` maps EVM/BTC chain_kinds to Secp256k1 + ECDSA, but the only evidence in this repo of a working sign-and-broadcast roundtrip is with Curve25519 + EdDSA (e2e + `force_curve25519` debug flag). **Action**: run one real Sepolia end-to-end during Phase 7.4 (full-flow script). If the mock rejects secp256k1, document the limitation and set `force_curve25519` default=`true` for demo reliability.

---

## 16. Ika pre-alpha feature mapping

**Scope lock:** Solana wallet (Phantom / Solflare / Backpack) is the **only**
control plane. Every multisig approval is an ed25519 signature over a
human-readable offchain message, signed by a Solana wallet. Destination
chains — Solana itself, EVM, ERC-20, Bitcoin, Zcash — are just addresses
the multisig's dWallets happen to own. No MetaMask, no WebAuthn, no
cross-wallet signing.

This section enumerates every Ika pre-alpha capability and maps it to a
concrete action — in-scope or explicitly out-of-scope.

### 16.1 What Ika pre-alpha exposes

Source: [solana-pre-alpha.ika.xyz](https://solana-pre-alpha.ika.xyz/)
developer guide.

**4 dWallet curves:**

| Curve | Discriminant (u16 LE) | Use-cases | In scope? |
|---|---|---|---|
| Secp256k1 | 0 | Bitcoin, Ethereum, Zcash | **YES** — BTC, EVM, ERC-20, Zcash |
| Secp256r1 | 1 | WebAuthn / passkeys | NO — no destination chain uses this |
| Curve25519 | 2 | Solana, Sui | **YES** — Solana dWallet |
| Ristretto | 3 | Polkadot sr25519 | NO — not a destination chain |

**7 signature schemes** (`DWalletSignatureScheme`):

| Scheme | Curve | Destination | In scope? |
|---|---|---|---|
| `EcdsaKeccak256` | Secp256k1 | EVM (ETH, L2s), ERC-20 | **YES** |
| `EcdsaSha256` | Secp256k1 / r1 | Bitcoin legacy | NO — P2WPKH uses double-sha256 |
| `EcdsaDoubleSha256` | Secp256k1 | Bitcoin P2WPKH (BIP143) | **YES** |
| `TaprootSha256` | Secp256k1 | Bitcoin Taproot | NO — hackathon scope |
| `EcdsaBlake2b256` | Secp256k1 | Zcash ZIP-243 (personalised) | **YES** — with personalisation |
| `EddsaSha512` | Curve25519 | Solana, Sui Ed25519 | **YES** |
| `SchnorrkelMerlin` | Ristretto | Polkadot sr25519 | NO |

**11 protocol operations** (`DWalletRequest` variants):

| Operation | Purpose | In scope? |
|---|---|---|
| `DKG` | Create a new dWallet | **YES** — `wallet add-chain` |
| `Sign` | Sign a message against an existing dWallet | **YES** — `proposal execute` |
| `ImportedKeySign` | Sign with an imported external key | NO — we create all keys via DKG |
| `Presign` | Allocate a curve-and-algorithm-only presign (nonce reserve) | **YES** — used inside `proposal execute` |
| `PresignForDWallet` | Allocate a presign tied to a specific dWallet | NO — `Presign` is simpler; we don't need per-dWallet binding today |
| `ImportedKeyVerification` | Verify external key → dWallet | NO — see ImportedKeySign |
| `ReEncryptShare` | Re-encrypt the user's secret share | NO — key recovery is post-hackathon |
| `MakeSharePublic` | Publish the encrypted share (trust-minimised mode) | NO — we stay zero-trust |
| `FutureSign` | Pre-commit signing intent, sign later | NO — our approve-then-execute pattern already gives the same guarantees in Solana-land |
| `SignWithPartialUserSig` | Complete a FutureSign | NO |
| `ImportedKeySignWithPartialUserSig` | Same, imported-key variant | NO |

**Three relevant on-chain PDAs** (all owned by the Ika dWallet program):

| PDA | Seeds | Use |
|---|---|---|
| `DWalletCoordinator` | `["dwallet_coordinator"]` | Readiness probe before DKG |
| `DWallet` | `["dwallet", chunks_of(curve \|\| pubkey)]` | Stores curve + authority + current pubkey |
| `MessageApproval` | `["message_approval", dwallet, keccak256(preimage)]` | Tracks pending / signed status for a single message |

All three are already used by `cli/src/ika.rs` + `programs/clear-wallet/src/instructions/ika_sign.rs`.

### 16.2 What we build for the hackathon

Only four Ika-related work items remain now that Phase 0 is done. The rest
is a matter of surfacing what already works.

#### 16.2.1 Pre-alpha mock banner

**What:** A dismissible but recurring banner pinned under the header on
every page:

```
⚠  Ika pre-alpha · mock signer (single-node, not distributed MPC) · devnet only
```

- Amber/warning colour from the design tokens, not red (red = error).
- Collapses to a small pill ("⚠ pre-alpha") after first dismissal, per-session `sessionStorage`.
- Link inside the banner → a `/app/about` modal explaining: "Ika pre-alpha currently runs a single mock signer. In Alpha 1 this becomes a distributed MPC network. All interfaces / addresses / signatures shown here are real cryptographically, only the MPC guarantees are emulated."

**Why:** Honesty. Judges will ask "is this real MPC?" The answer is "the
cryptography is real, the distribution is emulated" — and that answer is
easier to give if the UI says so up front.

**Where:**
- `frontend/src/components/layout/PreAlphaBanner.tsx`
- Mount from `frontend/src/app/app/layout.tsx` (just inside the `HeaderBar`)
- Copy also lands in the `README.md` "Known limitations" section

**Acceptance:** Banner visible on first page load for every new session;
collapses on click; never appears on the public landing page (only on
`/app/*`).

#### 16.2.2 Chain-to-scheme picker and `signing_params` unification

**What:** `cli/src/ika.rs::signing_params` currently returns a tuple
`(DWalletCurve, DWalletSignatureAlgorithm, DWalletHashScheme)`. Now that
the pinned SDK has a unified `DWalletSignatureScheme` enum, collapse the
tuple to a single `DWalletSignatureScheme` everywhere it flows — `Presign`
request, `Sign` request, and the on-chain `signature_scheme` byte in
`IkaConfig` + `MessageApproval`.

Map per-`chain_kind`:

| chain_kind | Curve | Scheme |
|---|---|---|
| `0` Solana | `Curve25519` | `EddsaSha512` |
| `1` EVM 1559 | `Secp256k1` | `EcdsaKeccak256` |
| `2` Bitcoin P2WPKH | `Secp256k1` | `EcdsaDoubleSha256` |
| `3` Zcash transparent | `Secp256k1` | `EcdsaBlake2b256` (with personalisation in `message_metadata`) |
| `4` EVM ERC-20 | `Secp256k1` | `EcdsaKeccak256` |

**Why:** Fewer moving parts. The old three-tuple was a leak from the
pre-redesign API; keeping it around confuses which chain pairs with which
scheme and makes the `force_curve25519` escape hatch feel more important
than it is.

**Where:**
- Refactor `cli/src/ika.rs::signing_params` to return
  `(DWalletCurve, DWalletSignatureScheme)`.
- Remove the `force_curve25519` CLI flag entirely. If the pre-alpha mock
  rejects secp256k1 in practice, surface the server-side error cleanly
  instead of letting users silently downgrade the signature type. A
  demo that secretly EdDSA-signs a message the user thinks is ECDSA is
  worse than one that fails loud.
- Update `programs/clear-wallet/src/state/ika_config.rs` — `signature_scheme: u8`
  stores the `DWalletSignatureScheme` u16-LE low byte. Since all 7 schemes
  fit in 0–6, a u8 is fine; add a comment pointing at the canonical enum.

**Acceptance:** `grep -R force_curve25519 --include='*.rs' --include='*.ts'`
returns nothing. All destination chains compute the right scheme from
`chain_kind` alone.

#### 16.2.3 `message_metadata` for Zcash personalisation

**What:** The redesigned `DWalletRequest::Sign` carries a
`message_metadata: Vec<u8>` that the signer forwards along with the message.
For Zcash ZIP-243 transparent, this is where `Blake2bMessageMetadata`
lives (`personal = "ZcashSigHash"`, `salt = consensus_branch_id`). For
every other chain it's empty bytes.

The on-chain program's `chains::message_metadata` already knows how to
produce these bytes per `chain_kind`. The CLI needs to:

1. Read the intent's `chain_kind` off the Intent account.
2. Ask the on-chain renderer (or mirror it locally) to compute the
   metadata bytes.
3. Pass them as the `message_metadata` field of the `Sign` gRPC request.

**Why:** Without this, Zcash signatures hash with the default
`EcdsaBlake2b256` salt and fail at ZIP-243 verification.

**Where:**
- `cli/src/ika.rs::sign` — receives `message_metadata: Vec<u8>` parameter
  (it already does in the current code, from Phase 0). The caller in
  `cli/src/commands/proposal.rs::execute_via_ika` computes it from the
  intent + chain_kind.
- Mirror the calculation in `frontend/src/lib/msig/chainmeta.ts` so the
  browser preview can show "signature scheme: EcdsaBlake2b256 with
  personal 'ZcashSigHash' || branch_id=0x…" on the Zcash detail pane.

**Acceptance:** Zcash `proposal execute --broadcast` produces a signature
that verifies against the destination address's scriptSig on-chain.

#### 16.2.4 `DWalletCoordinator` + `MessageApproval` lifecycle exposure

**What:** The CLI already polls `DWalletCoordinator` (readiness) and
`MessageApproval` (pending → signed). Surface both stages in the UI so
approvers watch their signature materialise in real-time:

```
proposal detail page:
  ┌ signing pipeline ───────────────────────────────┐
  │  ✓ threshold reached (2/3)                      │
  │  ✓ MessageApproval PDA created       (tx: abc…) │
  │  ⧗ Ika network presigning …                     │
  │    └ dwallet: bc1q…  scheme: EcdsaDoubleSha256   │
  │  ⧗ Ika network signing …                        │
  │  ⏸ destination broadcast pending                │
  └─────────────────────────────────────────────────┘
```

Each stage is a live `Solana.onAccountChange` subscription + a presign/sign
gRPC response handler.

**Why:** MPC flows are invisible to users today. Showing the stages makes
the "real cryptography happens here" story concrete and visually compelling
for judges.

**Where:**
- `frontend/src/components/proposals/SigningPipeline.tsx` (new)
- Consumed from `frontend/src/app/app/proposals/[proposal]/page.tsx`
- Relays for the gRPC stages come from a new backend SSE endpoint
  `GET /proposals/{proposal}/stream` that proxies the CLI's stderr (which
  already prints each step as a `✓` line)

**Acceptance:** While a remote execute runs, all five stages tick from
`⧗` → `✓` in under 15 seconds without any manual refresh.

### 16.3 What we deliberately don't build (and why the answer survives judging)

- **No ImportedKey flows.** All dWallets are DKG'd fresh on `wallet add-chain`. "Why not support bringing an existing BTC key?" → "Because the multisig's custody guarantee depends on the key having been generated under MPC from the start. Importing a key someone else held first breaks that."
- **No ReEncryptShare.** Post-hackathon. Until Alpha 1 ships, there's no encrypted user share to re-encrypt anyway (mock signer).
- **No MakeSharePublic.** Zero-trust mode is the stronger guarantee; the mode switch doesn't matter while the signer is mocked.
- **No FutureSign.** Our approve-then-execute flow already solves the same problem on-chain — the `MessageApproval` PDA IS a pre-commitment. FutureSign only wins when the destination chain is the pre-commitment substrate, which isn't our design.
- **No Taproot.** P2WPKH covers 95% of hot-wallet spend flows; Taproot is a Phase 10 item.
- **No WebAuthn / Secp256r1.** No destination chain in our scope uses it.
- **No Polkadot / Ristretto.** Same — no destination chain uses it.
- **No GasDeposit / IKA staking.** Pre-alpha mock doesn't enforce it. Alpha 1 will, at which point we add a deposit flow as a Phase 11 item.

Every "no" here maps to a bullet in the judging FAQ (`docs/FAQ.md`,
Phase 8.3), so you don't get caught flat-footed when asked.

### 16.4 Where these land in the existing phases

- **Phase 5.5 (proposal detail page)** absorbs **16.2.4** (signing pipeline)
- **Phase 6.2** picks up **16.2.1** (banner)
- **Phase 1 / 2 scope extension**: fold **16.2.2** (scheme unification) into the CLI pre-signed mode work — it's a small refactor that goes well with touching `ika.rs`
- **Phase 3.5 / 5.3** extend to cover **16.2.3** (Zcash metadata) — the TS renderer needs a chain-specific metadata computation

No phase count changes; these are additions within existing phases.

---

*Update this doc as scope shifts. Every change goes here, no off-doc decisions.*
