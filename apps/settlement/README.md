# rust-settlement

Naira ↔ crypto on-ramp service that backs clear-msig's `/buy` and
`/sell` pages.

The frontend's wallet hub surfaces "Buy with naira" / "Sell to bank"
actions. Clicking through opens a hosted Paystack or Kora checkout,
the user pays in NGN, and this service handles everything from
"payment confirmed" to "crypto disbursed to the wallet's address" —
state machine, idempotency, treasury signing, and the disbursement
broadcast itself.

It runs as a **sidecar to clear-msig's main backend** with its own
Cargo workspace (different `solana-sdk` / `ethers` minor versions
than the workspace CLI uses). The frontend talks to it directly via
`NEXT_PUBLIC_RAMP_API_URL`; clear-msig's main backend doesn't proxy
through it.

## What it does

```
User clicks "Buy with naira" in clear-msig
  → frontend creates a ramp intent here (RAMP API)
  → service opens Paystack/Kora hosted checkout in a new tab
  → user pays NGN at the provider
  → provider posts webhook → service marks intent paid
  → settlement worker disburses SOL/ETH from the treasury keypair
    to the wallet's chain-native address
  → frontend polls intent status, surfaces the confirmation
```

## Layout

| Path | What |
|---|---|
| `src/http/` | Axum HTTP routes (intent create, status, webhook) |
| `src/paystack/`, `src/kora/` | Provider adapters — checkout link, signature verify |
| `src/contracts/` | Treasury signer + disbursement broadcast |
| `src/domain/` | Intent state machine + persistence |
| `src/db.rs` | Postgres pool (`DATABASE_URL` / `DATABASE_URL_DIRECT`) |
| `migrations/` | Schema migrations applied at boot |

## Run locally

```bash
cp .env.example .env  # fill in DB + active provider's keys
cargo run             # binds RAMP_BIND_ADDR (default 0.0.0.0:8088)
```

The frontend defaults `NEXT_PUBLIC_RAMP_API_URL` to
`http://127.0.0.1:8088`, so a local `cargo run` is picked up
automatically.

## Status

Pre-alpha alongside clear-msig. Treasury signer uses a raw keypair
backend today; production would move to a hardware module. The two
supported chains for disbursement match clear-msig's primary
demonstration paths (Solana devnet + EVM testnet).

> **Pre-alpha — do not use with real funds.** Same posture as
> clear-msig itself: see the root [`README.md`](../README.md) for
> the project's overall safety disclaimer.
