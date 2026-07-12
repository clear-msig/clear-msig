# clear-msig-backend-api

HTTP adapter service that exposes stable JSON APIs for frontend integration.
It links the same typed Rust execution library used by the `clear-msig` binary
and runs commands in a bounded blocking-worker pool. No HTTP endpoint launches
the CLI executable.

This is the backend bridge between UI and your existing on-chain + CLI flows.

## Why this service exists

- Keeps the frontend decoupled from execution details. Typed proposal lifecycle
  and execution routes use domain commands directly; legacy routes still have
  adapter argument builders scheduled for migration.
- Preserves your proven CLI logic instead of duplicating transaction logic.
- Validates legacy adapter invocations against the full CLI schema and validates
  typed proposal commands through closed enums, bounded collections, and value
  size limits. Both paths receive execution timeouts, response caps, worker
  concurrency limits, and structured logs.
- Provides one place for request validation, timeout control, and uniform error envelopes.

## Start

From workspace root:

```bash
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
- `CLEAR_MSIG_ENV` (`production` enables fail-closed CORS and redacted internal errors)
- `CLEAR_MSIG_URL` (optional global `--url`)
- `CLEAR_MSIG_KEYPAIR` (optional global `--keypair`)
- `CLEAR_MSIG_SIGNER` (optional global `--signer`)
- `CLEAR_MSIG_CMD_TIMEOUT_SECS` (default `120`)
- `CLEAR_MSIG_EXECUTION_WORKERS` (default `8`; bounds in-process blocking work)
- `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM` (optional default `--dwallet-program` for chain bind + execute)
- `CLEAR_MSIG_DEFAULT_GRPC_URL` (optional default `--grpc-url` for chain bind + execute)
- `CLEAR_MSIG_DEFAULT_DEST_RPC_URL` (optional default `--rpc-url` for execute)
- `CLEAR_MSIG_PRO_STORE_PATH` (optional Pro schedules/audit JSON store; defaults to `/data/pro-store.json` on Render when `/data` exists)
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (production Redis REST store for notifications, agent state, and shared rate-limit paths)

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

Development execution failures include detailed core diagnostics. Production
responses retain the stable error kind but redact internal execution details;
full diagnostics remain in protected structured logs.

The Solana and Ika clients used by the shared core are currently synchronous.
If an HTTP timeout fires after work starts, that worker may finish in the
background; the semaphore keeps the number of such workers bounded. Migrating
those adapters to cancellable async I/O remains separate hardening work.

## Deployment model

- Deploy `clear-wallet` on Solana.
- Use the current deploy source of truth in `docs/deploy-current.md`.
- Backend production runs on Render from `render.yaml`.
- Frontend production runs on Vercel from `frontend/vercel.json`.
- Production Redis is Upstash Redis REST.
- Run `clear-msig-backend-api` as your backend service.
- Frontend talks only to this service.
