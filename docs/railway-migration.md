# Railway + Vercel production deploy

The production frontend is Vercel at `https://clearsig.xyz`. The backend runs on
the Railway `clear-msig-backend` service; shared distributed state continues to
use Upstash Redis REST.

Use `docs/deploy-current.md` as the source of truth for the current program id,
Alchemy RPC, and upgrade authority.

## Railway setup

1. Connect `clear-msig/clear-msig` from GitHub and deploy `main` from the
   repository root.
2. Railway detects the root `Dockerfile`; `railway.json` owns the start command,
   `/health` check, restart policy, and timeout.
3. Configure these service variables:
   - `CLEAR_MSIG_ENV=production`
   - `CLEAR_MSIG_URL=<Alchemy Solana devnet RPC>`
   - `CLEAR_MSIG_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v`
   - `CLEAR_MSIG_ALLOWED_ORIGIN=https://clearsig.xyz,https://www.clearsig.xyz`
   - `CLEAR_MSIG_ATTESTATION_DIR=/data/attestations`
   - `CLEAR_MSIG_PRO_STORE_PATH=/data/pro-store.json`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `CLEAR_MSIG_KEYPAIR_BASE64`
   - `CLEAR_MSIG_SIGNER_BASE64`
   - `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM`
   - `CLEAR_MSIG_DEFAULT_GRPC_URL`
   - `CLEAR_MSIG_DEFAULT_DEST_RPC_URL`
   - `RUST_LOG=info`
4. Attach a persistent volume mounted at `/data`; DKG attestations live in
   `/data/attestations`.
5. Do not set `PORT` or `BACKEND_API_BIND`. Railway provides `PORT`, and the
   entrypoint binds to `0.0.0.0:$PORT`.
6. Generate a public Railway domain and wait for `/health` to pass.

The production container fails closed when either backend keypair or either
Upstash variable is absent. Upstash remains the distributed state service; no
Railway Redis or database is required.

## Vercel cutover

After Railway is healthy, update the Vercel production env var:

```text
NEXT_PUBLIC_BACKEND_API_URL=https://clear-msig-backend-production.up.railway.app
NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
NEXT_PUBLIC_SOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH
UPSTASH_REDIS_REST_URL=<Upstash Redis REST URL>
UPSTASH_REDIS_REST_TOKEN=<Upstash Redis REST token>
```

Then redeploy the Vercel frontend.

For local frontend development, you can set:

```text
NEXT_PUBLIC_BACKEND_API_URL=/backend
```

Next.js will proxy `/backend/*` to the configured backend via
`frontend/next.config.ts`.

## Notes

- Railway HTTP health checks use `/health`.
- A successful health check proves process readiness, not ClearSign contract
  compatibility. Probe `/v1/clearsign/v3/prepare` before the Vercel cutover.
- Railway health, membership lookup, ClearSign v3 preparation, and the governed
  devnet v3 smoke passed before the Vercel production cutover.
- The obsolete Render blueprint and frontend fallback were removed after both
  Railway and Vercel reported successful deployment.
