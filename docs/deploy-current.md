# Current deploy runbook

This is the current ClearSig production/devnet deployment shape.

## Infrastructure

- On-chain program: Solana devnet `clear_wallet`
- Program id: `53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v`
- Current upgrade authority: `GpTfW9LiJb8pM2xmi7oENuUiV1e4LurPu9rzcPfhaJCM`
- Local authority keypair: `target/deploy/clear_wallet-keypair.json`
- Devnet RPC: Alchemy devnet
- Backend: Render service `clear-msig-backend`
- Frontend: Vercel project serving `https://clearsig.xyz`
- Redis: Upstash Redis REST, via `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN`

Do not use the older `XiVxc8...` authority notes for current deploys.
Do not default program deploys to `backend-api/keys/payer.json`.

## Program deploy

Build:

```bash
quasar build
```

Deploy:

```bash
scripts/prealpha/deploy-clear-wallet-devnet.sh
```

The helper defaults to:

```text
PAYER_KEYPAIR=target/deploy/clear_wallet-keypair.json
UPGRADE_AUTHORITY=target/deploy/clear_wallet-keypair.json
PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
DEVNET_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
DEPLOY_TRANSPORT=--use-rpc
```

After deploy:

```bash
./scripts/smoke-live.sh --address GpTfW9LiJb8pM2xmi7oENuUiV1e4LurPu9rzcPfhaJCM
```

## Backend deploy

Render is configured by `render.yaml`.

Required Render environment:

```text
CLEAR_MSIG_ENV=production
CLEAR_MSIG_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
CLEAR_MSIG_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
CLEAR_MSIG_ALLOWED_ORIGIN=https://clearsig.xyz,https://www.clearsig.xyz
UPSTASH_REDIS_REST_URL=<Upstash Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash Redis REST token>
CLEAR_MSIG_KEYPAIR_BASE64=<backend payer keypair>
CLEAR_MSIG_SIGNER_BASE64=<backend signer keypair>
CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM=<Ika dWallet program>
CLEAR_MSIG_DEFAULT_GRPC_URL=<Ika gRPC URL>
CLEAR_MSIG_DEFAULT_DEST_RPC_URL=<destination chain RPC URL>
CLEAR_MSIG_DELIVERY_STORE_PATH=/data/destination-deliveries.json
```

Render deploys from the configured GitHub branch. If work is on a feature
branch, merge/rebase it into the Render branch before expecting production to
move.

## Frontend deploy

Vercel builds `frontend/` with `frontend/vercel.json`.

Required Vercel environment:

```text
NEXT_PUBLIC_BACKEND_API_URL=https://clear-msig-backend.onrender.com
NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
NEXT_PUBLIC_SOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
UPSTASH_REDIS_REST_URL=<Upstash Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash Redis REST token>
```

Redeploy Vercel after frontend API contract, ClearSign hashing, or program id
changes.
