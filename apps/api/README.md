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

This script auto-creates `apps/api/.env.pre-alpha` from template on first run, then stops so you can set key paths.

Use the provided profile file and update key paths first:

```bash
cp apps/api/.env.pre-alpha.example apps/api/.env.pre-alpha
# edit CLEAR_MSIG_KEYPAIR and CLEAR_MSIG_SIGNER
set -a && source apps/api/.env.pre-alpha && set +a
cargo run -p clear-msig-backend-api
```

This sets backend-owned runtime defaults for Solana devnet + Ika pre-alpha so the frontend only sends user intent/policy inputs.

## Environment variables

- `BACKEND_API_BIND` (default `127.0.0.1:8080`)
- `CLEAR_MSIG_ENV` (`production` enables fail-closed CORS and redacted internal errors)
- `CLEAR_MSIG_BACKEND_GATEWAY_TOKEN` (server-only 32–512-character token, shared with the authenticated Next gateway; required for unsigned privileged routes in every environment. Configure outside source control; never expose with a NEXT_PUBLIC prefix)
- `CLEAR_MSIG_URL` (optional global `--url`)
- `CLEAR_MSIG_KEYPAIR` (optional global `--keypair`)
- `CLEAR_MSIG_SIGNER` (optional global `--signer`)
- `CLEAR_MSIG_CMD_TIMEOUT_SECS` (default `120`)
- `CLEAR_MSIG_EXECUTION_WORKERS` (default `8`; bounds in-process blocking work)
- `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM` (optional default `--dwallet-program` for chain bind + execute)
- `CLEAR_MSIG_DEFAULT_GRPC_URL` (optional default `--grpc-url` for chain bind + execute)
- `CLEAR_MSIG_DEFAULT_DEST_RPC_URL` (trusted default destination `--rpc-url` for execute)
- `CLEAR_MSIG_ALLOWED_DEST_RPC_URLS` (optional comma-separated exact additional destination URLs, maximum 32; configure the BTC, Zcash, Hyperliquid, and other supported broadcast endpoints here before rollout. Browser requests may only select this allowlist or the trusted default; custom browser RPC settings alone do not authorize backend access)
- `CLEAR_MSIG_PRO_STORE_PATH` (optional Pro schedules/audit JSON store; production uses `/data/pro-store.json` on the mounted Railway volume)
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
Destination and Redis HTTP response bodies are streamed with a 4 MiB decoded
size limit. Reconciliation requires an explicit result and matching
transaction identity; malformed responses leave delivery unknown rather than
being treated as confirmation or permission to rebroadcast.

The process-local rate limiter caps key cardinality and key length, expires old
buckets, and never increments rejected requests. These caller-selected keys do
not authenticate the requester or replace shared ingress throttling.

Solana account reads, wallet scans, blockhash reads, and transaction submission
also pass through an injectable execution-library port; command handlers cannot
construct an SDK RPC client directly.
Ika submission uses a separate injectable port whose public contract contains
no tonic or experimental Ika SDK types; only the live adapter owns that stack.

## Deployment model

- Deploy `clear-wallet` on Solana.
- Use the current deploy source of truth in `docs/deploy-current.md`.
- Backend production runs on Railway from the root `Dockerfile` and
  `railway.json`.
- Frontend production runs on Vercel from `apps/web/vercel.json`.
- Production Redis is Upstash Redis REST.
- Run `clear-msig-backend-api` as your backend service.
- Frontend talks only to this service.

## Authenticated ingress for unsigned operations

All `/v1/pro/**` routes, including metadata reads, and `POST /wallets` plus
`POST /wallets/{name}/chains/add` require `x-clearsig-backend-token`. Missing
server configuration fails closed with 503; missing, incorrect, or repeated
credentials return 401 before parsing bodies, reading private Pro state, or
invoking an execution command. Comparison uses a constant-time digest check.
There is no development or devnet bypass. Public health/chain reads and existing
member-signed command contracts retain their current authorization behavior.

The Next gateway must independently verify the Dynamic session and canonical
wallet access before adding this server-only header. It must discard any
client-supplied gateway header. The shared token authenticates the gateway or
operator, not a wallet member and not a quorum vote.

Wallet sponsorship requires the authenticated actor in the requested initial
membership and bounded sponsorship requests. Chain binding remains a privileged
creator/operator bootstrap action: the browser gateway refuses it until a
quorum-backed binding protocol exists. Membership alone is insufficient. The
onchain creator is the original payer stored in `wallet.creator`; deployment of
the creator-only binding guard must be reviewed alongside this ingress change.
Existing operator bootstrap tooling needs the server token, and old unsigned
browser chain-add requests must not silently regain access.

No token was generated or installed by this audit. Set matching private
configuration explicitly before rollout, keep the direct backend behind
controlled ingress, and independently review migrations and program deployment.
