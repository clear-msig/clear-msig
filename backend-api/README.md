# clear-msig-backend-api

HTTP adapter service that exposes stable JSON APIs for frontend integration.
It links the same typed Rust execution library used by the `clear-msig` binary
and runs commands in a bounded worker pool. Solana RPC and Ika gRPC operations
use cancellation-aware async clients; no HTTP endpoint launches the CLI executable.

This is the backend bridge between the UI and typed on-chain execution flows.

## Why this service exists

- Keeps the frontend decoupled from execution details. Wallet, intent, proposal,
  ClearSign lookup, typed lifecycle, and typed execution routes construct closed
  domain commands directly.
- Calls the reusable execution library directly instead of duplicating
  transaction logic or invoking the CLI binary.
- Validates route commands through closed enums, bounded collections, and value
  size limits from the lightweight command-contract crate. All paths receive
  execution timeouts, response caps, worker concurrency limits, and structured
  logs.
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
- `CLEAR_MSIG_DELIVERY_STORE_PATH` (development-only BTC/EVM/Zcash receipt file)
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (required production Redis REST store for distributed delivery receipts/leases, notifications, agent state, and shared rate-limit paths)

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

If an HTTP timeout fires, the backend cancels the request and gives its worker a
bounded drain window. Solana RPC and Ika gRPC futures are dropped on that signal.
BTC, EVM, and Zcash broadcasts use the same cancellation signal through a
mockable destination transport port. CPU-only assembly remains synchronous and
bounded; all current network futures are dropped when execution is cancelled.
Remote broadcasts also persist deterministic delivery receipts before network
submission. Retries reconcile the chain-native transaction ID before deciding
whether the exact signed bytes may be sent again. Configure
Upstash through `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Production startup fails closed when Redis is not
configured. Local CLI and development backend runs retain the file adapter at
`CLEAR_MSIG_DELIVERY_STORE_PATH`.
Solana account reads, wallet scans, blockhash reads, and transaction submission
also pass through an injectable execution-library port; command handlers cannot
construct an SDK RPC client directly.
Ika submission uses a separate injectable port whose public contract contains
no tonic or experimental Ika SDK types; only the live adapter owns that stack.

## Deployment model

- Deploy `clear-wallet` on Solana.
- Use the current deploy source of truth in `docs/deploy-current.md`.
- Backend production runs on Render from `render.yaml`.
- Frontend production runs on Vercel from `frontend/vercel.json`.
- Production Redis is Upstash Redis REST.
- Run `clear-msig-backend-api` as your backend service.
- Frontend talks only to this service.
