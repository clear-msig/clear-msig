# clear-msig

> **Sign intents, not hex.** A clear-signing multisig on Solana that drives native transactions on Ethereum, Bitcoin, Zcash, and every chain Ika supports — from one signing flow.

| | |
|---|---|
| Live demo | **[clearsig.xyz](https://clearsig.xyz)** |
| GitHub | [clear-msig/clear-msig](https://github.com/clear-msig/clear-msig) |
| Program ID (devnet) | [`53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v`](https://explorer.solana.com/address/53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v?cluster=devnet) |
| Backend (Render) | [clear-msig-backend.onrender.com](https://clear-msig-backend.onrender.com/health) |

> **Pre-alpha — do not use with real funds.** Devnet only. Ika is currently a single mock signer, not production distributed MPC.

## Overview

Treasury teams sign blind hex blobs on hardware wallets today. clear-msig replaces that with **human-readable sentences** — the same string the device displays, the same string the on-chain policy verifies, the same string the Ika dWallet network turns into a native transaction on its bound chain.

A 2-of-3 Solana multisig can drive an Ethereum transfer, a Bitcoin spend, then a Zcash withdrawal — **one signing flow, every chain**. Powered by Solana on-chain policy + [Ika](https://ika.xyz) dWallet 2PC-MPC signing. The dWallet's public key IS the address on each destination chain, so there is no vault PDA, no bridge, no wrapped asset.

Built with [Quasar](https://github.com/blueshift-gg/quasar).

## Supported Chains

| `chain` value | Curve | Signing Scheme | What it signs |
|---|---|---|---|
| `solana` | Curve25519 | EdDSA + SHA-512 | SOL transfers via durable nonce |
| `evm_1559` | Secp256k1 | ECDSA + Keccak-256 | EIP-1559 native transfers (ETH / L2s) |
| `evm_1559_erc20` | Secp256k1 | ECDSA + Keccak-256 | ERC-20 `transfer(address,uint256)` |
| `bitcoin_p2wpkh` | Secp256k1 | ECDSA + Double-SHA-256 | BIP143 P2WPKH spends |
| `zcash_transparent` | Secp256k1 | ECDSA + BLAKE2b-256 | ZIP-243 transparent P2PKH |

## How It Works

**Wallets** hold **intents** — pre-configured transaction blueprints. Each intent specifies its chain, parameters, proposers, approvers, threshold, and timelock.

Every wallet is created with three meta-intents — **AddIntent** (0), **RemoveIntent** (1), **UpdateIntent** (2) — used to amend the wallet itself. Custom intents (index 3+) define chain-specific transactions. Approvers see a human-readable message:

```
expires 2030-01-01 00:00:00: approve transfer 1000000000 lamports to 9abc... | wallet: treasury proposal: 42
```

### Execution Flow

```
propose → approve (threshold) → execute:
  1. On-chain ika_sign builds chain preimage → keccak256 → MessageApproval PDA
  2. CLI presign via Ika gRPC
  3. CLI sign via Ika gRPC → 64-byte signature
  4. CLI assembles chain-native transaction and broadcasts
```

## Architecture

```
Wallet              PDA: ["clear_wallet", creator, sha256(name)]
  ├── Intent 0      AddIntent (meta)
  ├── Intent 1      RemoveIntent (meta)
  ├── Intent 2      UpdateIntent (meta)
  └── Intent 3+     Custom — Solana / EVM / BTC / ZEC transfers

IkaConfig           PDA: ["ika_config", wallet, chain_kind]
                    (wallet, dwallet, user_pubkey, signature_scheme)

DwalletOwnership    PDA: ["dwallet_owner", dwallet]
                    Atomic authority transfer + immutable ownership lock

Proposal            PDA: ["proposal", intent, index]
                    params_data, approval / cancellation bitmaps
```

## Quick Start

### Run the devnet demo

The fastest path: build the CLI, fund a payer at [faucet.solana.com](https://faucet.solana.com/), and run the bootstrap script. It walks the full propose → approve → execute → broadcast flow against the live devnet program.

```bash
cargo build -p clear-msig-cli
./scripts/cli-demo-bootstrap.sh
```

The script generates fresh keypairs in `~/clear-msig-demo/`, prompts for funding, and prints the final broadcast URL. Re-runnable; each invocation creates a new wallet.

### Build from source

**Prerequisites**
- Rust (stable), [Quasar CLI](https://github.com/blueshift-gg/quasar), Agave v3.1+
- `protoc` — `brew install protobuf` or `apt-get install protobuf-compiler`
- OpenSSL dev headers — macOS: `brew install openssl@3 pkg-config && export OPENSSL_DIR=$(brew --prefix openssl@3)`

**Build**

```bash
quasar build                        # On-chain program → target/deploy/clear_wallet.so
cargo build -p clear-msig-cli       # CLI → target/debug/clear-msig
```

### Configure

```bash
clear-msig config set --url https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
clear-msig config set --payer  ~/.config/solana/id.json
clear-msig config set --signer ~/.config/solana/id.json
clear-msig config set --expiry-seconds 600
```

### Create a 2-of-3 multisig

```bash
clear-msig wallet create \
  --name "treasury" \
  --proposers $S1,$S2,$S3 \
  --approvers $S1,$S2,$S3 \
  --threshold 2
```

### Bind a chain

```bash
# Solana (Curve25519 Ed25519 dWallet)
clear-msig wallet add-chain --wallet "treasury" --chain solana \
  --dwallet-program <DWALLET_PROGRAM_ID>

# EVM (Secp256k1 ECDSA dWallet)
clear-msig wallet add-chain --wallet "treasury" --chain evm_1559 \
  --dwallet-program <DWALLET_PROGRAM_ID>

clear-msig wallet chains --wallet "treasury"
```

### Propose, approve, execute

```bash
clear-msig intent add --wallet "treasury" \
  --file examples/intents/solana_transfer.json \
  --proposers $S1,$S2,$S3 --approvers $S1,$S2,$S3 --threshold 2

clear-msig proposal create --wallet "treasury" --intent-index 3 \
  --param "destination=<RECIPIENT>" \
  --param "amount=1000000000" \
  --param "nonce_value=0x<NONCE_HEX>"

clear-msig proposal approve --wallet "treasury" --proposal <P> --signer signer2.json
clear-msig proposal approve --wallet "treasury" --proposal <P> --signer signer3.json

clear-msig proposal execute --wallet "treasury" --proposal <P> \
  --dwallet-program <DWALLET_PROGRAM_ID> \
  --rpc-url https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH --broadcast
```

## Intent JSON

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

Per-chain examples live in `examples/intents/`.

**Parameter types:** `address`, `u64`, `i64`, `string`, `bool`, `u8`, `u16`, `u32`, `u128`, `bytes20`, `bytes32`.

**Template decimal shift:** `{2:10^18}` renders `100000000000000` as `0.0001` (wei → ETH).

## Identity Model

- **Payer** — Solana keypair that pays transaction fees.
- **Signer** — Ed25519 identity used for multisig message signing. Can be a Ledger device.

```bash
clear-msig config set --keypair ~/payer.json
clear-msig config set --signer  ~/signer.json
# Or: --signer-ledger --ledger-account 0
```

## dWallet Ownership

The Ika dWallet program has a single CPI authority per caller program. clear-msig adds a per-dWallet ownership lock (`DwalletOwnership` PDA) so each multisig wallet truly owns its dWallet — no other wallet under the same program can sign with it. A first bind is accepted only when the immediately preceding instruction in the same transaction transfers that exact dWallet to clear-msig's CPI authority. Existing locks remain immutable.

## Project Structure

```
programs/clear-wallet/src/
  state/          Wallet, Intent, Proposal, IkaConfig, DwalletOwnership
  instructions/   create_wallet, propose, approve, cancel, execute,
                  cleanup, bind_dwallet, ika_sign
  chains/         Per-chain preimage builders
  utils/          Message building, ika_cpi, hashing
  client/         PDA derivation, intent builder, JSON parsing

cli/src/
  commands/       wallet, intent, proposal, config
  chains/         Per-chain broadcast adapters
  ika.rs          gRPC DKG / presign / sign, PDA + preimage helpers

backend-api/      Axum relayer linked to the shared Rust execution library
frontend/         Next.js 15 + React 19 app
examples/intents/ Per-chain intent JSON templates
```

## Security

The full attack-surface walkthrough lives in [SECURITY.md](SECURITY.md). Read it before changing any sign or verify path.

## Documentation

- [Product overview](docs/product-overview.md)
- [Agent trading vault spec](docs/agent-trading-vault.md)
- [Agent trading vault MVP plan](docs/agent-trading-vault-mvp-plan.md)
- [Encrypt pre-alpha integration notes](docs/encrypt-prealpha-testing.md)
- [Current deploy runbook](docs/deploy-current.md)
- [Render and Vercel deploy notes](docs/render-migration.md)
