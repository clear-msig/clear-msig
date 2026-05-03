# clear-msig

> **Sign intents, not hex.** A clear-signing multisig on Solana that drives native transactions on Ethereum, Bitcoin, Zcash, and any chain Ika supports — from one signing flow.

| | |
|---|---|
| 🌐 Live demo | **[clear-msig.vercel.app](https://clear-msig.vercel.app)** |
| 🎬 Demo video | _coming soon — Colosseum submission_ |
| 📦 GitHub | [clear-msig/clear-msig](https://github.com/clear-msig/clear-msig) |
| 🔗 Program ID (devnet) | [`ahVmthS8EwXMpckBQdxGeHmbFghxoqKBaFjSCizcvFL`](https://explorer.solana.com/address/ahVmthS8EwXMpckBQdxGeHmbFghxoqKBaFjSCizcvFL?cluster=devnet) |
| 🛰 Backend (Fly.io) | [clear-msig-backend.fly.dev](https://clear-msig-backend.fly.dev/health) |

## What it does

Treasury teams sign blind hex blobs on their Ledgers today. clear-msig replaces that with **human-readable sentences** — the same string your Ledger displays, the same string the on-chain policy verifies, the same string the Ika dWallet network turns into a native transaction on whatever chain it's bound to.

A 2-of-3 Solana multisig can drive an Ethereum transfer, then a Bitcoin spend, then a Zcash withdrawal. **One signing flow. Every chain.** Powered by Solana on-chain policy + [Ika](https://ika.xyz) dWallet 2PC-MPC signing — the dWallet's public key IS the address on each destination chain, so there's no vault PDA, no bridge, no wrapped asset.

Built with [Quasar](https://github.com/blueshift-gg/quasar). Fork of [`ChewingGlass/clear-msig`](https://github.com/ChewingGlass/clear-msig).

> **Pre-alpha — do not use with real funds.** The on-chain `clear-wallet` program runs only on Solana devnet. Ika's dWallet network is a single mock signer, not production distributed MPC. Devnet state is wiped periodically. APIs, account layouts, and signed-message formats can change without notice.

See [DEPLOYMENTS.md](DEPLOYMENTS.md) for the deployed program ID and Ika endpoints.

## Supported Chains

| `chain` value | Curve | Signing Scheme | What it signs |
|---|---|---|---|
| `solana` | Curve25519 | EdDSA + SHA-512 | SOL transfers via durable nonce |
| `evm_1559` | Secp256k1 | ECDSA + Keccak-256 | Native EVM EIP-1559 (ETH/L2s) |
| `evm_1559_erc20` | Secp256k1 | ECDSA + Keccak-256 | ERC-20 `transfer(address,uint256)` |
| `bitcoin_p2wpkh` | Secp256k1 | ECDSA + Double-SHA-256 | BIP143 P2WPKH spends |
| `zcash_transparent` | Secp256k1 | ECDSA + BLAKE2b-256 | ZIP-243 Sapling transparent P2PKH |

## How It Works

**Wallets** hold **intents** — pre-configured transaction blueprints. Each intent specifies its chain, parameters, proposers, approvers, thresholds, and timelock.

Three meta-intents are created with every wallet:
- **AddIntent** (0), **RemoveIntent** (1), **UpdateIntent** (2)

Custom intents (index 3+) define the chain-specific transaction. Approvers see a human-readable message:

```
expires 2030-01-01 00:00:00: approve transfer 1000000000 lamports to 9abc... | wallet: treasury proposal: 42
```

### Execution Flow (all chains)

```
propose → approve (2-of-3) → execute:
  1. On-chain ika_sign builds preimage → keccak256 → MessageApproval PDA
  2. CLI presign via Ika gRPC
  3. CLI sign via Ika gRPC → 64-byte signature
  4. CLI assembles chain-native transaction + broadcasts
```

## Architecture

```
Wallet (PDA: ["clear_wallet", sha256(name)])
  └── Intent 0: AddIntent (meta)
  └── Intent 1: RemoveIntent (meta)
  └── Intent 2: UpdateIntent (meta)
  └── Intent 3+: Custom (Solana/EVM/BTC/ZEC transfers)

IkaConfig (PDA: ["ika_config", wallet, chain_kind])
  └── (wallet, dwallet, user_pubkey, signature_scheme)

DwalletOwnership (PDA: ["dwallet_owner", dwallet])
  └── First binder wins — immutable ownership lock

Proposal (PDA: ["proposal", intent, index])
  └── params_data, approval/cancellation bitmaps
```

## Encrypt — confidential policies (pre-alpha)

A multisig is only as private as its on-chain footprint. The **proposers list, approvers list, threshold, allowances, recipient allowlists** sit in plaintext today, which means a Solana explorer can read your wallet's full org chart and spending rules. clear-msig integrates [Encrypt](https://encrypt.xyz) ([dwallet-labs/encrypt-pre-alpha](https://github.com/dwallet-labs/encrypt-pre-alpha)) to fix that: every policy field becomes an FHE ciphertext on chain, the program runs threshold checks and allowance arithmetic *directly on the encrypted bytes* via `#[encrypt_fn]` handlers, and only the wallet members ever see plaintext.

### Role of Encrypt in this app

- **Confidentiality.** Approvers, thresholds, per-friend allowances, and recipient allowlists are stored as ciphertext identifiers, not plaintext. An off-chain reader sees opaque blobs.
- **Computation on ciphertexts.** Approval threshold, allowance arithmetic, and recipient allowlist matching run inside FHE-aware program handlers. The program never sees plaintext.
- **Pre-share at edit time, not run time.** When a user changes a policy, the frontend encrypts the new value against the network's public key off-chain, the program references the resulting ciphertext identifier, and verifications happen at signing / executing time without round-tripping plaintext.

### Current state — honest

| Layer | Status | Where |
|---|---|---|
| Frontend client + UI scaffold | **Wired.** Every policy mutation routes through `encryptPolicy` / `encryptPolicyBatch`. | `frontend/src/lib/encrypt/client.ts` |
| Local pass-through SDK shim | **Live.** Returns deterministic `ciphertext_id` so persistence + UI work end-to-end before the network ships. | `frontend/src/lib/encrypt/local-client.ts` |
| Real network client (`@encrypt.xyz/pre-alpha-solana-client`) | **Pending.** SDK not yet on npm. Single-file swap when it ships. | one diff in `client.ts` |
| CLI forwarding of ciphertext IDs | **Logs only.** IDs flow frontend → backend → CLI, get printed (`[encrypt] intent-add received N policy ciphertext id(s): …`) but are not yet threaded into the on-chain instruction. | `cli/src/commands/intent.rs`, `cli/src/commands/wallet.rs` |
| On-chain `#[encrypt_fn]` handlers + `EUint*` slots | **Not implemented.** The program has zero FHE-aware code today. Approval / threshold / allowance checks operate on plaintext. | `programs/clear-wallet/` |

Net: the wire path is real and the UI shows "encryption-ready · pre-alpha" on every relevant chip, but **policies are not actually encrypted on chain yet**. The full security accounting lives in [SECURITY.md](SECURITY.md). Anyone reading the README literally and missing the pre-alpha label has been overclaimed to.

### Why the scaffold matters before the network is live

When Encrypt's pre-alpha network ships its npm SDK and exposes a public gRPC endpoint, the frontend swap is one diff in `lib/encrypt/client.ts` (replace `localEncryptClient` with the real gRPC-Web client + the network's encryption key). The CLI + program work is the bulk of the lift after that, but the application surface — `encryptPolicy(plaintext, ctx)` → `EncryptedPayload`, `decryptPolicy(payload)` → bytes — is already the shape the integration will land at, so call sites don't change.

## Quick Start

### Try the live devnet deployment

The fastest path. Build the CLI, fund a payer at https://faucet.solana.com/, and run the bootstrap script — it does the entire propose → approve → execute → broadcast flow against the existing devnet program:

```bash
cargo build -p clear-msig-cli
./scripts/cli-demo-bootstrap.sh
```

The script generates fresh keypairs in `~/clear-msig-demo/`, prompts you to fund the payer when needed, and prints the final broadcast tx URL. Re-runnable; each invocation creates a new wallet.

### Build from source

#### Prerequisites

- Rust (stable), [Quasar CLI](https://github.com/blueshift-gg/quasar), Agave v3.1+
- `protoc` (for the Ika gRPC client) — `brew install protobuf` or `apt-get install protobuf-compiler`
- OpenSSL dev headers — on macOS: `brew install openssl@3 pkg-config` and `export OPENSSL_DIR=$(brew --prefix openssl@3)`

#### Build

```bash
quasar build                        # On-chain program → target/deploy/clear_wallet.so
cargo build -p clear-msig-cli       # CLI → target/debug/clear-msig
```

### Deploy your own copy + Configure

```bash
solana program deploy target/deploy/clear_wallet.so
# Update declare_id! in programs/clear-wallet/src/lib.rs and pub const ID in
# programs/clear-wallet/client/src/lib.rs to match the program ID you got back,
# then rebuild + re-upload to the same keypair (target/deploy/clear_wallet-keypair.json).

clear-msig config set --url https://api.devnet.solana.com
clear-msig config set --payer  ~/.config/solana/id.json
clear-msig config set --signer ~/.config/solana/id.json
clear-msig config set --expiry-seconds 600
```

### Create a 2-of-3 Multisig

```bash
clear-msig wallet create \
  --name "treasury" \
  --proposers $S1,$S2,$S3 \
  --approvers $S1,$S2,$S3 \
  --threshold 2
```

### Add a Chain

```bash
# Solana (Curve25519 Ed25519 dWallet)
clear-msig wallet add-chain --wallet "treasury" --chain solana \
  --dwallet-program <DWALLET_PROGRAM_ID>

# EVM (Secp256k1 ECDSA dWallet)
clear-msig wallet add-chain --wallet "treasury" --chain evm_1559 \
  --dwallet-program <DWALLET_PROGRAM_ID>

# Check addresses
clear-msig wallet chains --wallet "treasury"
```

### Propose + Approve + Execute

```bash
# Add a transfer intent
clear-msig intent add --wallet "treasury" \
  --file examples/intents/solana_transfer.json \
  --proposers $S1,$S2,$S3 --approvers $S1,$S2,$S3 --threshold 2
# Approve + execute the AddIntent proposal...

# Propose a SOL transfer
clear-msig proposal create --wallet "treasury" --intent-index 3 \
  --param "destination=<RECIPIENT>" \
  --param "amount=1000000000" \
  --param "nonce_value=0x<NONCE_HEX>"

# Approve (2 of 3)
clear-msig proposal approve --wallet "treasury" --proposal <P> --signer signer2.json
clear-msig proposal approve --wallet "treasury" --proposal <P> --signer signer3.json

# Execute + broadcast
clear-msig proposal execute --wallet "treasury" --proposal <P> \
  --dwallet-program <DWALLET_PROGRAM_ID> \
  --rpc-url https://api.devnet.solana.com --broadcast
```

### EVM Example (Sepolia)

```bash
clear-msig proposal create --wallet "treasury" --intent-index 4 \
  --param nonce=0 \
  --param to=0x000000000000000000000000000000000000dEaD \
  --param value_wei=1000000000000000 \
  --param data=

# After 2/3 approval:
clear-msig proposal execute --wallet "treasury" --proposal <P> \
  --dwallet-program <DWALLET_PROGRAM_ID> \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
```

## Intent JSON Format

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

See `examples/intents/` for all chain examples: `solana_transfer.json`, `evm_transfer.json`, `erc20_transfer.json`, `btc_transfer.json`, `zcash_transfer.json`.

### Parameter Types

`address`, `u64`, `i64`, `string`, `bool`, `u8`, `u16`, `u32`, `u128`, `bytes20`, `bytes32`

### Template Decimal Shift

`{2:10^18}` renders `100000000000000` as `0.0001` (wei to ETH).

## Two-Identity Model

- **Payer** — Solana keypair that signs transactions and pays fees
- **Signer** — Ed25519 identity for multisig message signing (can be Ledger)

```bash
clear-msig config set --keypair ~/payer.json
clear-msig config set --signer ~/signer.json
# Or: --signer-ledger --ledger-account 0
```

## dWallet Ownership Model

The Ika dWallet program has a single CPI authority per caller program. clear-msig adds a **per-dWallet ownership lock** (`DwalletOwnership` PDA) so each multisig wallet truly owns its dWallet — no other wallet under the same program can sign with it.

## Project Structure

```
programs/clear-wallet/src/
  state/          Wallet, Intent, Proposal, IkaConfig, DwalletOwnership
  instructions/   create_wallet, propose, approve, cancel, execute (meta-intents),
                  cleanup, bind_dwallet, ika_sign
  chains/         Solana, EVM, Bitcoin, Zcash preimage builders
  utils/          Message building, ika_cpi, hashing
  client/         PDA derivation, intent builder, JSON parsing

cli/src/
  commands/       wallet, intent, proposal, config
  chains/         Solana, EVM, Bitcoin, Zcash broadcast adapters
  ika.rs          gRPC DKG/presign/sign, PDA helpers, preimage builders

examples/intents/ Intent JSON files for all chains
```

## Known Issues

- Requires Agave v3.1+ (SBPFv2 r2 data pointer)
- Ika pre-alpha: mock signer, not production MPC
- Solana intents require a durable nonce account with authority set to the dWallet pubkey
- Quasar IDL lint stage is disabled in `Quasar.toml`. Field-level `#[allow(quasar::*)]` suppressions are wrapped in `#[cfg_attr(target_os = "solana", ...)]` so the host build doesn't trip on the unknown tool name; that gating also hides them from Quasar's lint parser, which only unwraps plain `#[allow(...)]`. The on-chain runtime checks all the same invariants regardless. Re-enable lint once Quasar's parser unwraps `cfg_attr`.
