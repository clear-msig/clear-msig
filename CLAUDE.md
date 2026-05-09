# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`clear-msig` is a clear-signing multisig on **Solana devnet** that drives **native** transactions on **Solana, EVM 1559 (incl. ERC-20), Bitcoin P2WPKH, and Zcash transparent** via the [Ika](https://solana-pre-alpha.ika.xyz/) dWallet 2PC-MPC network. The dWallet's pubkey IS the address on each destination chain — no vault PDA, no bridge, no wrapped assets. Approvers always sign a human-readable message (e.g. `expires 2030-01-01: approve transfer 1000000000 lamports to 9abc... | wallet: treasury proposal: 42`); the same string is what the on-chain policy verifies and what a Ledger device renders verbatim.

**Pre-alpha. Devnet only. Ika is a single mock signer, not real distributed MPC.** Do not use with real funds.

## Workspace layout

Single Cargo workspace + a Next.js frontend. Members: `programs/clear-wallet`, `programs/clear-wallet/client`, `cli`, `e2e`, `backend-api`. The frontend (`frontend/`) is a separate npm project. `deps/solana-curve25519` is a local patch fed to all crates via `[patch.crates-io]` in the root `Cargo.toml` — do not delete or "tidy" it.

```
programs/clear-wallet/    On-chain Solana program (Quasar / SBPFv2)
  src/state/              Wallet, Intent, Proposal, IkaConfig, DwalletOwnership
  src/instructions/       create_wallet, propose, approve, cancel, execute,
                          cleanup, bind_dwallet, ika_sign
  src/chains/             Per-chain preimage builders (solana_dwallet, evm,
                          bitcoin, zcash). Byte-exact match with cli/src/chains.
  src/utils/              Message building, ika_cpi, hashing
  client/                 Quasar-generated Rust client (PDA derivation, JSON parse)
cli/                      Rust CLI binary `clear-msig` — propose/approve/execute
  src/chains/             Per-chain broadcast adapters (solana_broadcast, evm,
                          bitcoin, zcash) — must stay byte-exact with the
                          program's chains/ preimage builders.
  src/ika.rs              Ika gRPC client (DKG / presign / sign), preimage helpers
  src/quasar_client/      Vendored copy of the Quasar-generated client. Hand-edited.
backend-api/              Axum HTTP+SSE adapter that shells out to the CLI.
                          Stateless. Holds a gas-payer keypair only — never
                          computes ed25519 multisig signatures itself.
e2e/                      Standalone binary that runs the full lifecycle on devnet.
frontend/                 Next.js 15 + React 19 app. Wallet adapters via Dynamic
                          Labs + Ledger WebHID. Direct Solana RPC for reads;
                          backend-api for writes that need the CLI.
examples/intents/         JSON intent templates per chain
scripts/                  cli-demo-bootstrap.sh + scripts/prealpha/* (env bootstrap,
                          phase check scripts, devnet deploy)
```

## Build & run

### Prereqs

- Rust stable, Agave **v3.1+** (SBPFv2 r2 data pointer required)
- [Quasar CLI](https://github.com/blueshift-gg/quasar) for on-chain builds
- `protoc` — `brew install protobuf` (Ika gRPC client)
- OpenSSL — `brew install openssl@3 pkg-config && export OPENSSL_DIR=$(brew --prefix openssl@3)`
- Node.js + npm for the frontend

### Common commands

```bash
# On-chain program → target/deploy/clear_wallet.so
quasar build

# CLI binary → target/debug/clear-msig (most workflows need this built first;
# the backend-api shells out to it)
cargo build -p clear-msig-cli

# Workspace check (used as the Phase 0 gate)
cargo check --workspace --all-targets

# Program tests (Quasar-svm framework, runs cargo test tests::)
cargo test -p clear-wallet tests::
cargo test -p clear-wallet tests::FULL_LIFECYCLE   # single test by name

# Backend (defaults bind 127.0.0.1:8080)
cargo run -p clear-msig-backend-api
# Pre-alpha profile (recommended) — auto-creates .env.pre-alpha on first run:
./scripts/prealpha/start-backend.sh

# Frontend (port 3000)
cd frontend && npm install && npm run dev
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run test           # vitest run (single file: npx vitest run path/to/file.test.ts)
npm run build          # NODE_OPTIONS=--max-old-space-size=4096 next build

# End-to-end against existing devnet program (generates keypairs, prompts to
# fund payer, runs propose → approve → execute → broadcast):
cargo build -p clear-msig-cli && ./scripts/cli-demo-bootstrap.sh

# Standalone e2e binary (requires --dwallet-program ID):
cargo run -p e2e-clear-msig-ika -- <DWALLET_PROGRAM_ID>

# Devnet deploy of clear-wallet
./scripts/prealpha/deploy-clear-wallet-devnet.sh
# After deploy, update declare_id! in programs/clear-wallet/src/lib.rs AND
# pub const ID in programs/clear-wallet/client/src/lib.rs, then rebuild and
# re-upload to the same keypair (target/deploy/clear_wallet-keypair.json).
```

### Phase check scripts

`scripts/prealpha/check-phase{1,2,3,4}.sh` are go/no-go gates the development plan refers to (see `DEVELOPMENT.md`). Run them after any change that touches the corresponding layer.

## Architecture — the load-bearing details

### Three trust zones

| Zone | Key material | What it does |
|---|---|---|
| User browser | User's wallet (Phantom/Solflare/Backpack/Dynamic embedded/**Ledger**) | Signs ed25519 messages only. Never pays gas. |
| Backend relayer (Fly.io) | Gas payer keypair | Pays Solana fees, shells out to the CLI. **Cannot impersonate signers.** |
| On-chain program (devnet) | Wallet PDAs, IkaConfig PDA, DwalletOwnership PDA | Enforces threshold + timelock + ownership. Drives Ika via CPI. |

If the relayer disappears, users can still read on-chain state and (Phase 5) submit from their own wallet. The relayer is convenience, not dependency.

### Wallet PDA derivation — read this before touching wallet creation

The current program derives wallet PDAs from `["clear_wallet", creator_pubkey, sha256(name)]` and stores `creator` on the wallet account. Two creators can both pick `Family` and land at distinct PDAs. **Old wallets created during the `name#XXXXXX`-suffix workaround era are unreachable by the upgraded program** — they have a different PDA layout. Do not add code that re-strips the suffix on the assumption that legacy wallets are still addressable.

### Account map

```
Wallet            PDA: ["clear_wallet", creator, sha256(name)]
  Intent 0        AddIntent (meta)
  Intent 1        RemoveIntent (meta)
  Intent 2        UpdateIntent (meta)
  Intent 3+       Custom (Solana / EVM / EVM-ERC20 / BTC / ZEC transfers)

IkaConfig         PDA: ["ika_config", wallet, chain_kind]
                  → (wallet, dwallet, user_pubkey, signature_scheme)

DwalletOwnership  PDA: ["dwallet_owner", dwallet]
                  → first binder wins; immutable ownership lock so no
                    other wallet under the same caller program can sign
                    with this dWallet.

Proposal          PDA: ["proposal", intent, index]
                  → params_data, approval/cancellation bitmaps
```

### Execution flow (every chain uses this exact path)

```
propose → approve (threshold) → execute:
  1. On-chain ika_sign builds chain-specific preimage → keccak256 → MessageApproval PDA
  2. CLI presign via Ika gRPC
  3. CLI sign via Ika gRPC → 64-byte signature
  4. CLI assembles chain-native transaction + broadcasts (eth_sendRawTransaction,
     Esplora POST /tx, Zcash RPC, or Solana sendTransaction)
```

`ChainKind::Solana = 0` is **not** a local-vault CPI. It's an Ika Curve25519 dWallet whose pubkey IS the Solana address. Every chain — Solana included — goes through the same Ika-driven path. Solana intents additionally require a **durable nonce account whose authority is set to the dWallet pubkey**.

### Byte-exact preimage parity (very important)

For each chain, the preimage built by `programs/clear-wallet/src/chains/<chain>.rs` must produce **exactly** the same bytes as the broadcast adapter in `cli/src/chains/<chain>.rs` would have hashed before signing. A one-byte divergence (off-by-one length prefix, wrong endianness, missing branch ID) produces a signature the destination chain rejects. When you change one side, change the other in the same diff and add/extend a parity test in `programs/clear-wallet/src/tests.rs`.

| Chain | Preimage | Sig hash | Broadcast |
|---|---|---|---|
| `solana` (via Ika) | tx sighash | EdDSA / SHA-512 (Curve25519) | `sendTransaction` |
| `evm_1559` | RLP | Keccak-256 | `eth_sendRawTransaction` |
| `evm_1559_erc20` | RLP w/ `transfer(address,uint256)` calldata | Keccak-256 | `eth_sendRawTransaction` |
| `bitcoin_p2wpkh` | BIP143 | Double-SHA-256 | Esplora `POST /tx` |
| `zcash_transparent` | ZIP-243, personalised `ZcashSigHash \|\| branch_id` | BLAKE2b-256 | Zcash RPC |

### Ika integration — the pin matters

`ika-grpc` and `ika-dwallet-types` are pinned in `cli/Cargo.toml` to commit `3bd7945e012950e54fb4d0057b72a7d466556fc1` (2026-04-17). This is the post-redesign API: `DWalletSignatureScheme`, `UserSecretKeyShare`, `VersionedDWalletDataAttestation`, `VersionedPresignDataAttestation`. The earlier pin `40ba20db` predates the redesign and **will not compile** against `cli/src/ika.rs`. Bump both pins together if Ika rotates upstream.

`quasar-lang` in `cli/Cargo.toml` and `e2e/Cargo.toml` is pinned to `branch = "fix/signer-check-and-wincode-versions"`. The default master is missing the `TailBytes` export; do not let `cargo update` move it.

Devnet endpoints (`DEPLOYMENTS.md`):
- Ika dWallet program: `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`
- Ika gRPC: `https://pre-alpha-dev-1.ika.ika-network.net:443`
- clear-wallet program ID: `ahVmthS8EwXMpckBQdxGeHmbFghxoqKBaFjSCizcvFL`

### dWallet ownership lock

The Ika dWallet program has a single CPI authority per caller program. clear-msig adds a per-dWallet `DwalletOwnership` PDA (`["dwallet_owner", dwallet]`) so each multisig truly owns its dWallet. **First binder wins** — the lock is immutable. Code that calls `bind_dwallet` or `ika_sign` must always pass the `dwallet_ownership` account; e2e and CLI clients must include it in their accounts vec or account validation fails.

### Encrypt — confidential policies (scaffolded, not yet enforced)

Policy fields (proposers, approvers, threshold, allowances, recipient allowlists) are intended to live as **FHE ciphertext IDs** on chain via [Encrypt](https://docs.encrypt.xyz/). The Encrypt model: encrypted integer types (`EUint64` etc.) and `#[encrypt_fn]` handlers that compile to homomorphic computation graphs evaluated by off-chain executors; on-chain instructions reference ciphertext accounts. Three Rust crate variants exist: `encrypt-pinocchio`, `encrypt-anchor`, `encrypt-native`.

**Current state in this repo (do not overclaim):**

| Layer | Status | Where |
|---|---|---|
| Frontend client + UI scaffold | Wired. Every policy mutation routes through `encryptPolicy` / `encryptPolicyBatch`. | `frontend/src/lib/encrypt/client.ts` |
| Local pass-through SDK shim | Live. Returns deterministic `ciphertext_id` so persistence works pre-network. | `frontend/src/lib/encrypt/local-client.ts` |
| Real `@encrypt.xyz/pre-alpha-solana-client` | **Pending** (not yet on npm). One-diff swap when it ships. | `client.ts` |
| CLI forwarding of ciphertext IDs | Logs only. Frontend → backend → CLI flow exists, IDs are printed but not threaded into the on-chain instruction. | `cli/src/commands/intent.rs`, `cli/src/commands/wallet.rs` |
| On-chain `#[encrypt_fn]` handlers + `EUint*` slots | **Not implemented.** Approval/threshold/allowance checks operate on plaintext today. | `programs/clear-wallet/` |

The wire path is real, the UI shows "encryption-ready · pre-alpha" chips, but **policies are not actually encrypted on chain**. Do not change READMEs or UI copy to imply otherwise.

### Frontend — sign-payload integrity

Every signed write goes through `signDescriptor()` in `useSignWithWallet`. The hook **fetches the on-chain intent account, rebuilds the offchain-wrapped signable bytes locally with `buildSignableMessage`, and byte-compares against the descriptor's `message_hex`** before opening the wallet popup. A mismatch throws `WalletSignError("message_mismatch")`. The wallet signs the locally-rebuilt bytes, not the backend-supplied bytes. **Never call `signBytes(fromHex(...))` directly** — every new signed flow must go through `signDescriptor`. See `frontend/src/lib/msig/verify.ts` and the full attack model in `SECURITY.md` (surface A).

The Ledger path (`frontend/src/lib/wallet/ledger.ts`, `@ledgerhq/hw-transport-webhid` → `Solana.signOffchainMessage`) closes the sign-payload-substitution surface end-to-end: the device renders the wrapped offchain message body (magic prefix `\xffsolana offchain` + format byte 0) as plain text on hardware. `useWallet` prefers an active `LedgerSession` over Dynamic when both are available.

Frontend lib organization: `lib/msig/` (byte-exact TS port of the offchain wrap, datetime, render, encode, message, hash, types, accounts), `lib/chain/` (read-only direct Solana RPC — memberships, wallet, intents, proposals; **no backend dependency**), `lib/encrypt/` (Encrypt scaffold), `lib/wallet/` (Dynamic + Ledger), `lib/ikavery/` (vendored ikavery Solana SDK, BSD-3 — see Secure feature below).

### Secure — personal key recovery via ikavery (companion product on Ika dWallets)

`/app/secure/*` ships a personal-recovery vault product alongside the shared-wallet flow. Users place a Solana key under a t-of-N quorum of devices/passkeys and recover by signing a sweep with any threshold. Built on top of the [ikavery](https://github.com/Iamknownasfesal/ikavery) project; same Ika dWallet engine clear-msig uses for cross-chain signing, different user goal (single user, multi-device recovery).

| Layer | Status | Where |
|---|---|---|
| ikavery SDK (vendored, BSD-3) | Live. Solana SDK source copied to `frontend/src/lib/ikavery/` — upstream's `workspace:*` dep on `ikavery-core` doesn't resolve via npm, so we vendor and ship one helper inline. See `NOTICE.md` in that dir. | `lib/ikavery/` |
| Vault create flow | Live. `clearmsig-actions.ts::createSoloVault` builds the `create_recovery` ix, partial-signs with a fresh `recoveryId` keypair locally, hands off to the user's Dynamic wallet for the creator signature, submits + confirms. Solo (1-of-1) only at v2. | `lib/ikavery/clearmsig-actions.ts`, `app/app/secure/new/page.tsx` |
| Vault list + detail | Live. `listVaultsForCreator` filters `getProgramAccounts` by member-slot match. Detail page decodes member schemes (Solana / ed25519 / secp256k1 / passkey / WebAuthn). | `app/app/secure/page.tsx`, `app/app/secure/[recovery]/page.tsx` |
| dWallet handle | **Placeholder.** v2 uses a creator-XOR-random 32-byte stub. Real DKG against `pre-alpha-dev-1.ika.ika-network.net` (gRPC-Web) is the v3 lift. | `clearmsig-actions.ts::placeholderDwalletHandle` |
| Add device (passkey enrollment) | **Stub.** UI card on detail page links to `solana.ikavery.com`. v3. | — |
| Sweep (move funds out) | **Stub.** Same hand-off pattern. v3. | — |

The wallet shim (`lib/wallet/index.ts`) gained `signTransaction` for this flow — it goes through Dynamic's `solanaWallet.getSigner().signTransaction`. Ledger transaction signing for vault is also v3; the wizard gates on `isLedger` upfront with a "use a hot wallet" callout.

Sidebar entry: `WorkspaceSidebar` renders a "Secure" promo card (expanded mode) or icon (rail mode) replacing the old "Recent" section, which duplicated the wallet hub Activity tab.

## Two-identity model

- **Payer** — Solana keypair that signs transactions and pays fees
- **Signer** — Ed25519 identity for multisig message signing (can be Ledger)

```bash
clear-msig config set --keypair ~/payer.json
clear-msig config set --signer  ~/signer.json
# Or: --signer-ledger --ledger-account 0
```

## Intent JSON format

```json
{
  "chain": "solana",
  "tx_template": { "solana": { "nonce_account": "<NONCE_PUBKEY>" } },
  "params": [
    { "name": "destination", "type": "address" },
    { "name": "amount", "type": "u64" },
    { "name": "nonce_value", "type": "bytes32" }
  ],
  "template": "transfer {1} lamports to {0}"
}
```

Param types: `address`, `u64`, `i64`, `string`, `bool`, `u8`, `u16`, `u32`, `u128`, `bytes20`, `bytes32`. Template decimal shift `{2:10^18}` renders `100000000000000` as `0.0001` (wei → ETH). Examples: `examples/intents/{solana,evm,erc20,btc,zcash}_transfer.json`.

## Backend-api `/memberships` element sizes — landmine

`backend-api/src/main.rs::parse_intent_membership` parses raw on-chain intent bytes and **must use the exact element sizes** of the Rust structs in `programs/clear-wallet/src/utils/definition.rs`:

| Type | Size |
|---|---|
| `ParamEntry` | 14 (`1+2+2+1+8`) |
| `AccountEntry` | 7 (`1+1+1+2+2`) |
| `InstructionEntry` | 9 (`1+2+2+2+2`) |
| `DataSegmentEntry` | 5 (`1+2+2`) |
| `SeedEntry` | 5 (`1+2+2`) |

Wrong offsets silently corrupt dashboard data for any wallet with a custom intent. If you change the on-chain struct layout, update these constants in the same diff.

## Quasar IDL lint is disabled

`Quasar.toml` has `[lint] enabled = false` because field-level `#[allow(quasar::*)]` suppressions are wrapped in `#[cfg_attr(target_os = "solana", ...)]` (so the host build doesn't trip on the unknown tool name) and Quasar's lint parser doesn't unwrap `cfg_attr`. The on-chain runtime checks all the same invariants. Re-enable lint once Quasar's parser handles `cfg_attr`, or move to a different suppression strategy.

## Known issues / sharp edges

- `proposal cleanup` is broken at the Quasar framework level (`MissingRequiredSignature`). The frontend hides the button. Don't demo it; don't try to "fix" it inside this repo.
- `target_os = "solana"` cfg gating hides annotations from the Quasar lint parser (above).
- Solana intents need a durable nonce account with authority set to the dWallet pubkey, otherwise `ika_sign` builds a preimage that won't broadcast.
- Ika is a single mock signer pre-alpha — don't write code that assumes distributed-MPC properties (e.g. signer-set rotation, threshold MPC reshares).

## Reference docs in this repo

- `README.md` — user-facing intro, supported chains table, quick start
- `DEVELOPMENT.md` — phased build plan; treat as the source of truth for *what's next* and *what's done*
- `DEPLOYMENTS.md` — pinned program IDs, gRPC URLs, Fly.io + Vercel deploy steps
- `SECURITY.md` — attack-surface walkthrough (A–N); read before changing any sign / verify path
- `CORE_USECASE.md` — short product framing
- `COLOSSEUM_PLAN.md` — hackathon submission plan
- `backend-api/README.md` — env vars, endpoints, pre-alpha profile script
