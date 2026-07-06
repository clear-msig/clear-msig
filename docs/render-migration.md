# Render migration

The production frontend stays on Vercel at `https://clearsig.xyz`.
Move the backend API from Fly.io to Render with the root `render.yaml`.

## Render setup

1. In Render, create a new Blueprint from this repository.
2. Use `render.yaml` from the repo root.
3. Fill the required secret env vars:
   - `CLEAR_MSIG_KEYPAIR_BASE64`
   - `CLEAR_MSIG_SIGNER_BASE64`
   - `CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM`
   - `CLEAR_MSIG_DEFAULT_GRPC_URL`
   - `CLEAR_MSIG_DEFAULT_DEST_RPC_URL`
   - `CLEAR_MSIG_PROGRAM_ID` (optional; defaults to the fresh devnet program if omitted)
4. Keep the persistent disk mounted at `/data`; DKG attestations live in
   `/data/attestations`.
5. Wait for `/health` to pass.

The container binds to `0.0.0.0:$PORT`; Render defaults `PORT` to `10000`,
and the Blueprint pins `BACKEND_API_BIND=0.0.0.0:10000`.

## Vercel cutover

After Render is healthy, update the Vercel production env var:

```text
NEXT_PUBLIC_BACKEND_API_URL=https://clear-msig-backend.onrender.com
NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID=53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v
```

Then redeploy the Vercel frontend.

For local frontend development, you can set:

```text
NEXT_PUBLIC_BACKEND_API_URL=/backend
```

Next.js will proxy `/backend/*` to the Render backend via
`frontend/next.config.ts`.

## Notes

- `CLEAR_MSIG_ALLOWED_ORIGIN` is pinned to `https://clearsig.xyz` and
  `https://www.clearsig.xyz` in `render.yaml`.
- Render HTTP health checks use `/health`.
- The service uses one instance because it has a persistent disk. Render does
  not allow scaling services that attach a disk.
