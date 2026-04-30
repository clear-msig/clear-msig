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

---

# Web app deployment (frontend + backend)

Two-host setup, because Vercel can't run the long-lived Rust backend that shells out to the `clear-msig` CLI:

```
[Vercel: Next.js frontend] ──HTTPS──> [Fly.io: Rust backend + clear-msig CLI]
                                                   │
                                                   ▼
                                       Solana devnet + Ika gRPC
```

## Backend → Fly.io

One-time:

```bash
# 1. Authenticate (creates ~/.fly/config.yml)
fly auth login

# 2. Launch the app — picks up Dockerfile + fly.toml in repo root.
#    Use --no-deploy so we can set secrets first.
fly launch --no-deploy --copy-config --name <pick-a-unique-name>

# 3. Inject the keypairs as base64-encoded Fly secrets. The container's
#    entrypoint.sh decodes them to /tmp/payer.json and /tmp/signer.json
#    at boot.
fly secrets set \
  CLEAR_MSIG_KEYPAIR_BASE64="$(base64 -i ~/clear-msig-demo/payer.json)" \
  CLEAR_MSIG_SIGNER_BASE64="$(base64 -i ~/clear-msig-demo/signer1.json)"

# 4. Deploy
fly deploy
```

Subsequent updates: just `fly deploy`.

Note the keypair lives in a Fly secret (encrypted at rest, never logged). It's still a payer keypair on a remote host though — only use a devnet keypair you don't mind exposing if Fly itself is compromised.

## Frontend → Vercel

Two ways: dashboard import, or CLI.

**Dashboard** (recommended for first deploy):
1. https://vercel.com/new → import the GitHub repo.
2. **Root Directory** = `frontend` (Vercel picks Next.js as framework automatically).
3. Add environment variables:
   - `NEXT_PUBLIC_BACKEND_API_URL` = `https://<your-fly-app>.fly.dev`
   - `NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID` = `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`
   - `NEXT_PUBLIC_IKA_GRPC_URL` = `https://pre-alpha-dev-1.ika.ika-network.net:443`
   - `NEXT_PUBLIC_SOLANA_RPC_URL` = `https://api.devnet.solana.com`
   - `NEXT_PUBLIC_DESTINATION_RPC_URL` = `https://ethereum-sepolia-rpc.publicnode.com`
   - (Optional, for invitation emails) `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
4. Deploy.

**CLI**:
```bash
cd frontend
vercel link        # answer "Y, link to existing project" or create new
vercel env add NEXT_PUBLIC_BACKEND_API_URL production
# repeat for the other NEXT_PUBLIC_* vars
vercel --prod
```

## Post-deploy verification

```bash
# Backend health
curl https://<your-fly-app>.fly.dev/health

# Frontend should load and show the Connect Wallet button
open https://<your-vercel-app>.vercel.app
```

If the frontend loads but API calls fail, the most common causes are:
- `NEXT_PUBLIC_BACKEND_API_URL` typo (note the `https://` prefix).
- Fly app cold-start (rare with `min_machines_running = 1`, but possible if the warm machine was redeployed); first request wakes a stopped machine in ~5s.
- CORS — backend pins origins via `CORS_ALLOWED_ORIGINS`. If you change the Vercel URL, update the Fly secret.
