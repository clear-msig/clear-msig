# Deployments

Authoritative list of `clear-msig` program deployments and the third-party endpoints they're configured against. See [README.md](README.md) for what the program does.

> **Pre-alpha.** Ika dWallet is a mock signer, not production MPC. Solana devnet state is wiped periodically. Do not use with real funds.

## Solana devnet

| Resource | Value |
|---|---|
| **clear-wallet program ID** | `ahVmthS8EwXMpckBQdxGeHmbFghxoqKBaFjSCizcvFL` |
| Upgrade authority | `9Da5azHWDg9CKXwRdLy5d6c78rhKn3k5opFaWb2W7Mb1` |
| RPC URL | `https://api.devnet.solana.com` |
| Initial deploy commit | `78314c7` |
| Initial deploy date | 2026-04-29 |

### Required external endpoints

| Resource | Value | Source |
|---|---|---|
| Ika dWallet program | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` | [`dwallet-labs/ika-pre-alpha`](https://github.com/dwallet-labs/ika-pre-alpha#devnet) |
| Ika gRPC | `https://pre-alpha-dev-1.ika.ika-network.net:443` | same |

These are pinned in this project via `cli/Cargo.toml` (`ika-grpc`, `ika-dwallet-types` at rev `3bd7945e`). Update both at once if Ika rotates them.

## Configuring the CLI against this deployment

```bash
clear-msig config set --url https://api.devnet.solana.com
clear-msig config set --payer  ~/path/to/payer.json
clear-msig config set --signer ~/path/to/signer.json
clear-msig config set --expiry-seconds 600
```

Then for any `wallet add-chain`, `proposal execute`, etc., pass:

```bash
--dwallet-program 87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY
```

(or rely on the default if it's been wired into the binary — check `clear-msig wallet add-chain --help`).

## Verified end-to-end on devnet

| Step | Tx |
|---|---|
| Program initial deploy | [`4GtSB1Je…dmYaF`](https://explorer.solana.com/tx/4GtSB1Je6E9XnaJ773U73vADYRq4B37PESqgwnLdvCiNsirmgX2pSBNFxAxSLv6dU7YL4XWRoioYGi1EkWfDmYaF?cluster=devnet) |
| Program upgrade (post-ID fix) | [`5SHVUjod…V7jA`](https://explorer.solana.com/tx/5SHVUjodZFfQVVHx1LPoRRGn6p7R2MNu43Pc1eT27J3Cytw2LjUfJCbRfE6NF71bgfnHkqGQjoy2tvTQksT1V7jA?cluster=devnet) |
| 2-of-3 transfer (dWallet → payer, 0.1 SOL) | [`54k646oQ…Je9b`](https://explorer.solana.com/tx/54k646oQYjdaUFXKRkuKmAgLDjLzrm447KQ8k2vaznnzNa1TsRckuF2DDQEvS7yhzfHpQqKAaUP6N6yrckLbJe9b?cluster=devnet) |

## Other clusters

Not yet deployed.
