# clear-msig-backend-api

HTTP adapter service that wraps the `clear-msig` CLI and exposes stable JSON APIs for frontend integration.

This is the backend bridge between UI and your existing on-chain + CLI flows.

## Why this service exists

- Keeps frontend decoupled from CLI argument formatting.
- Preserves your proven CLI logic instead of duplicating transaction logic.
- Provides one place for request validation, timeout control, and uniform error envelopes.

## Start

From workspace root:

```bash
cargo build -p clear-msig-cli
cargo run -p clear-msig-backend-api
```

Default bind: `127.0.0.1:8080`

## Ika pre-alpha profile (recommended)

Fastest path from repo root:

```bash
./scripts/prealpha/start-backend.sh
```

This script auto-creates `backend-api/.env.pre-alpha` from template on first run, then stops so you can set key paths.

Use the provided profile file and update key paths first:

```bash
cp backend-api/.env.pre-alpha.example backend-api/.env.pre-alpha
# edit CLEAR_MSIG_KEYPAIR and CLEAR_MSIG_SIGNER
set -a && source backend-api/.env.pre-alpha && set +a
cargo run -p clear-msig-backend-api
```

This sets backend-owned runtime defaults for Solana devnet + Ika pre-alpha so the frontend only sends user intent/policy inputs.

## Environment variables

- `BACKEND_API_BIND` (default `127.0.0.1:8080`)
- `CLEAR_MSIG_WORKSPACE` (default current directory)
- `CLEAR_MSIG_BIN` (default `<workspace>/target/debug/clear-msig`)
- `CLEAR_MSIG_URL` (optional global `--url`)
- `CLEAR_MSIG_KEYPAIR` (optional global `--keypair`)
- `CLEAR_MSIG_SIGNER` (optional global `--signer`)
- `CLEAR_MSIG_CMD_TIMEOUT_SECS` (default `120`)
- `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM` (optional default `--dwallet-program` for chain bind + execute)
- `CLEAR_MSIG_DEFAULT_GRPC_URL` (optional default `--grpc-url` for chain bind + execute)
- `CLEAR_MSIG_DEFAULT_DEST_RPC_URL` (optional default `--rpc-url` for execute)
- `CLEAR_MSIG_PRO_STORE_PATH` (optional Pro schedules/audit JSON store; defaults to `/data/pro-store.json` on Render when `/data` exists)

## Core endpoints

- `GET /health`
- `POST /wallets`
- `GET /wallets/{name}`
- `GET /wallets/{name}/chains`
- `POST /wallets/{name}/chains/add`
- `GET /wallets/{name}/intents`
- `POST /wallets/{name}/intents/add`
- `POST /wallets/{name}/intents/remove`
- `POST /wallets/{name}/intents/update`
- `POST /wallets/{name}/proposals`
- `GET /wallets/{name}/proposals`
- `POST /wallets/{name}/proposals/{proposal}/approve`
- `POST /wallets/{name}/proposals/{proposal}/cancel`
- `POST /wallets/{name}/proposals/{proposal}/execute`
- `GET /proposals/{proposal}`
- `POST /proposals/{proposal}/cleanup`
- `GET /v1/pro/wallets/{name}/schedules`
- `POST /v1/pro/wallets/{name}/schedules`
- `POST /v1/pro/wallets/{name}/schedules/delete`
- `GET /v1/pro/wallets/{name}/escrows`
- `POST /v1/pro/wallets/{name}/escrows`
- `POST /v1/pro/wallets/{name}/escrows/delete`
- `GET /v1/pro/wallets/{name}/audit-events`
- `POST /v1/pro/audit-events`

## Error behavior

All failures return JSON with:

- `error` (human readable)
- `kind` (`bad_request`, `command_failed`, `timeout`, `invalid_output`, `internal`)

For command failures, response includes CLI `stderr`, `stdout`, and exit `code`.

## Deployment model

- Deploy `clear-wallet` on Solana.
- Run `clear-msig-backend-api` as your backend service.
- Ensure `clear-msig` binary is available on the same host/container.
- Frontend talks only to this service.
