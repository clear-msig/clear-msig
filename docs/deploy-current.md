# Current deploy runbook

This is the current ClearSig production/devnet deployment shape.

## Infrastructure

- On-chain program: Solana devnet `clear_wallet`
- Program id: `53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v`
- Current upgrade authority: `GpTfW9LiJb8pM2xmi7oENuUiV1e4LurPu9rzcPfhaJCM`
- Last deployed slot: `476404189`
- Current artifact SHA-256: `18884726babf2c4b73cca86da749e118ec7caa6278b6e5f3bbb4dfd641b12431`
- Deployment signature: `513iUUwAxfXmSKCT3nK3SUM2dtQqd2wn4q4SQPbHxBvvuxxX523qf2qqC3F5ydxnAUycGFgfSj4r4oacRE8qPUAW`
- Local authority keypair: `target/deploy/clear_wallet-keypair.json`
- Devnet RPC: Alchemy devnet
- Backend: Railway service `clear-msig-backend`
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

If `solana program deploy` reports that `ExtendProgram` requires at least
10,240 additional bytes, extend the existing program account by that minimum
and rerun the helper:

```bash
solana program extend \
  53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v \
  10240 \
  --url https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH \
  --keypair target/deploy/clear_wallet-keypair.json
```

Record the extension transaction and recheck the program authority before the
retry. A failed atomic allocation does not necessarily create the displayed
intermediate account; query it before attempting a close.

## Backend deploy

Railway builds the root `Dockerfile` using `railway.json`. The production
service is connected to `main`, uses `/health`, and mounts a persistent volume
at `/data`.

Required Railway environment:

```text
CLEAR_MSIG_ENV=production
CLEAR_MSIG_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
CLEAR_MSIG_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
CLEAR_MSIG_ALLOWED_ORIGIN=https://clearsig.xyz,https://www.clearsig.xyz
CLEAR_MSIG_ATTESTATION_DIR=/data/attestations
CLEAR_MSIG_PRO_STORE_PATH=/data/pro-store.json
UPSTASH_REDIS_REST_URL=<Upstash Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash Redis REST token>
CLEAR_MSIG_KEYPAIR_BASE64=<backend payer keypair>
CLEAR_MSIG_SIGNER_BASE64=<backend signer keypair>
CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM=<Ika dWallet program>
CLEAR_MSIG_DEFAULT_GRPC_URL=<Ika gRPC URL>
CLEAR_MSIG_DEFAULT_DEST_RPC_URL=<destination chain RPC URL>
```

Do not set `BACKEND_API_BIND` or `PORT` manually. Railway provides `PORT`, and
the entrypoint binds to `0.0.0.0:$PORT`. The container fails closed before
binding when either Upstash variable or either backend keypair is missing.

The `/data` volume is mandatory: Ika attestations and Pro state must survive
redeploys. Upstash remains the distributed receipt, lease, notification, agent
state, and rate-limit store; do not provision a second Redis service.

## Frontend deploy

Vercel builds `frontend/` with `frontend/vercel.json`.

Required Vercel environment:

```text
NEXT_PUBLIC_BACKEND_API_URL=https://clear-msig-backend-production.up.railway.app
NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
NEXT_PUBLIC_SOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
UPSTASH_REDIS_REST_URL=<Upstash Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash Redis REST token>
```

Redeploy Vercel after frontend API contract, ClearSign hashing, or program id
changes.
