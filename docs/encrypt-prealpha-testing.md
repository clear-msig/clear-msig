# Encrypt Pre-Alpha Integration

Clear's frontend can submit policy values to Encrypt's published
pre-alpha gRPC-Web `createInput` endpoint. This is the strongest
integration currently available from the public TypeScript package.

This does **not** change Clear's clear-signing flow. Users still sign
the same human-readable proposal messages, and the Solana program still
verifies those signatures exactly as before.

## What Is Wired

- Package: `@encrypt.xyz/pre-alpha-solana-client`
- Browser API: `createEncryptWebClient(...).createInput(...)`
- Config:
  - `NEXT_PUBLIC_ENCRYPT_GRPC_URL`
  - `NEXT_PUBLIC_ENCRYPT_NETWORK_KEY_HEX`
- Output: ciphertext identifiers flow into existing
  `policy_ciphertexts` request fields for wallet/intent setup flows.

When those env vars are missing, the frontend falls back to the local
pre-alpha stub so local development still works.

## What Is Not Yet Wired

- Clear's Solana program does not yet use `#[encrypt_fn]` handlers.
- `policy_ciphertexts` are not yet enforced by program state.
- Encrypt pre-alpha is not production privacy; it is an API-compatible
  integration surface.

## How To Test Against Encrypt

1. Install dependencies:

   ```bash
   cd apps/web
   npm ci
   ```

2. Add Encrypt config to `apps/web/.env.local`:

   ```bash
   NEXT_PUBLIC_ENCRYPT_GRPC_URL=https://<encrypt-grpc-web-endpoint>
   NEXT_PUBLIC_ENCRYPT_NETWORK_KEY_HEX=<32-byte-network-key-hex>
   ```

3. Start the frontend:

   ```bash
   npm run dev
   ```

4. Create or update a wallet/policy flow that calls
   `encryptPolicyBatch`, for example:

   - `/welcome`
   - `/app/wallet/new`
   - member add/remove/update flows
   - advanced policy rule save

5. Open browser DevTools and watch the Network tab for a gRPC-Web call
   to `NEXT_PUBLIC_ENCRYPT_GRPC_URL`.

6. Confirm generated policy identifiers are not local stub IDs:

   - local fallback IDs start with `ct_`
   - network byte identifiers are normalized as `enc_<hex>`
   - string identifiers returned by Encrypt are preserved as returned

7. Confirm clear signing is unchanged:

   - create a proposal
   - inspect the sign preview
   - the wallet/Ledger message should still be the readable Clear
     message, not an Encrypt payload

## Expected Failure Modes

- Missing env vars: local stub is used.
- gRPC-Web endpoint unavailable/CORS-blocked: console warns
  `[encrypt] network createInput failed; using local stub`.
- Invalid network key hex: config parsing throws during encryption.
