# ClearSign Operational Runbook

This file captures the failure modes that have already cost us time. Keep it
near the send-flow work so future ClearSign, Dynamic, and cross-chain changes
start from the same baseline.

## Non-Negotiable Invariants

- Every user action must show readable ClearSign text before signing.
- The readable text must match the exact on-chain ClearSign commitment.
- The wallet must sign the exact bytes that the backend and program verify.
- The frontend must not silently fall back from typed ClearSign to vague custom
  intents for money-moving actions.
- After any ClearSign hashing, typed action, signer, or program change, deploy
  both backend and frontend, then create a fresh request. Old prepared requests
  and old proposals can carry stale commitments.

## SOL Typed Send Baseline

SOL send is the current verified baseline for the typed ClearSign path:

1. Frontend asks the backend to prepare the typed proposal.
2. Backend builds canonical ClearSign v2 readable text and envelope hash.
3. Frontend verifies the readable action locally before opening the wallet
   signer.
4. Wallet signs the ClearSign v2 text bytes.
5. Backend submits the signed bytes.
6. On-chain program verifies the ClearSign envelope before executing.

Regression checks:

```bash
cargo test -p clear-msig-backend-api clearsign
npm test -- --run src/lib/clearsign-v2/__tests__/actions.test.ts src/lib/api/__tests__/errors.test.ts
npm run typecheck
```

For a live smoke test, send a small SOL amount on devnet after Render and
Vercel are both redeployed from the same commit. Do not reuse an old request.

## Dynamic Embedded Wallet Notes

Dynamic browser logs can be noisy. These are not automatically the root cause
of a failed send:

- `Error initializing waas`
- `Cannot redefine property: ethereum`
- LaunchDarkly initialization warnings

Treat them as signer-context clues, but inspect the backend error first. If the
backend says the wallet signed the wrong bytes or ClearSign text did not verify,
the signer path is the issue. Email sign-in / legacy Dynamic Solana embedded
paths can corrupt or replace Solana message bytes before signing, so they must
not be allowed to finish ClearSign-sensitive actions.

Compatible signer posture:

- Software wallets such as Solflare, Backpack, Phantom, or Coinbase Wallet can
  proceed when they sign the exact ClearSign bytes.
- Ledger is preferred for hardware-tier approval.
- Dynamic embedded Solana signing must only be used when its newer Solana path
  signs the exact ClearSign bytes and passes local byte verification.

## Error Map

`custom program error: 0x1788`

Usually `InvalidClearSignEnvelope`. Check hash parity between:

- `programs/clear-wallet/src/utils/clearsign.rs`
- `backend-api/src/clearsign/hash.rs`
- `frontend/src/lib/clearsign-v2/actions.ts`

This can also happen when Render or Vercel is still serving old code, or when
the user retries an old proposal created before the latest deploy.

`ClearSign details did not verify`

The readable text, policy fields, action id, nonce, expiry, payload hash, or
wallet id does not match the commitment. Create a fresh request after deploy.
Do not ask the user to sign the stale request again.

`Email sign-in cannot finish this Solana signature`

The active Dynamic signer path is not compatible with ClearSign byte signing.
Ask the user to sign in with a compatible Solana wallet or Ledger.

`Solana didn't accept that transaction`

This is a wrapper. Open the backend `stderr` and inspect the actual Solana RPC
or program error. Do not debug browser console noise first.

## Deploy Checklist

Before deploy:

```bash
cargo test -p clear-msig-backend-api clearsign
npm test -- --run src/lib/clearsign-v2/__tests__/actions.test.ts src/lib/balances/__tests__/index.test.ts
npm run typecheck
```

After deploy:

- Render backend must point at the same Solana program id as the frontend.
- Vercel frontend must be redeployed after backend/API contract or frontend
  ClearSign hash changes.
- Users must refresh the app and create a fresh send request.
- Run a devnet SOL smoke send with a tiny amount.
- Save the explorer transaction link in the release notes.

## Cross-Chain Balance And Send Notes

- ETH and ERC-20 use `NEXT_PUBLIC_DESTINATION_RPC_URL`.
- Hyperliquid must use `NEXT_PUBLIC_HYPERLIQUID_RPC_URL`, never the ETH RPC.
- Zcash has no safe browser public RPC default. If `NEXT_PUBLIC_ZCASH_RPC_URL`
  is missing, ZEC balance and send must fail closed instead of polling localhost.
- BTC balance and explorer links must stay network-specific. Testnet/signet
  links must not point users to mainnet mempool.

## What Still Needs The Typed Standard

The product standard is SOL typed ClearSign for every money-moving action.
These surfaces still need the same typed, no-hidden-hash treatment:

- ERC-20 send
- Hyperliquid trade flows outside the typed native HYPE send
- Agent-created proposals
- Policy/member/admin changes
- Escrow creation, approval, release, cancel, and cleanup

Until each surface is typed end to end, the UI should label it conservatively
and avoid implying the same assurance level as verified SOL typed send.
