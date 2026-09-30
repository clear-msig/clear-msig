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

## Settlement safety and rollout

Devnet uses the same verification checks as production. This local patch has not
been deployed and does not establish audited production readiness.

- New intents require a server-owned `ExecutableQuoteProvider`. The default
  provider is deliberately unavailable; caller USD estimates and independent
  crypto quantities cannot authorize checkout, disbursement, or fiat payout.
  Paystack and Korapay remain payment adapters, and no new price provider is
  silently activated. A reviewed executable-quote adapter is still required.
- `prepare-signature` returns `deposit_reference` (`clearsig-ramp:<intent UUID>`)
  and snapshots the trusted treasury. The actual transaction must include that
  exact reference. Browser `finalized`/`confirmations` claims are ignored.
- Native EVM deposits use exact calldata, native Solana deposits a System
  transfer plus Memo instruction, and Bitcoin/transparent Zcash deposits an
  exact OP_RETURN reference. Tokens, shielded transfers, and unsupported
  transaction shapes fail closed. The current Solana proof supports top-level
  System transfers, not multisig CPI transfers.
- Proof verification independently fetches network, exact sender/treasury/asset/
  amount, transaction identity, canonical block, reference, and finality from
  operator-configured RPCs. EVM and Solana require finalized state; Bitcoin
  requires six confirmations and Zcash ten. Funding block time must be within
  the executable quote's validity, while finality may arrive later.
- Solana requires `RAMP_SOLANA_CHAIN_ID` and `RAMP_SOLANA_GENESIS_HASH` to pin the
  intended cluster. Bitcoin validates the configured network's genesis block.
- Apply migration `0003_verified_deposit_evidence.sql` before rollout. Existing
  assertion-only deposit rows are never promoted to verified evidence. A global
  transaction/output uniqueness key and one verified deposit per intent prevent
  duplicate crediting; owner checks protect claims and idempotent retries.
- Checkout initialization durably reserves exactly one deterministic provider
  reference before network submission. Concurrent calls and response retries
  cannot initialize another checkout. Incomplete/unknown attempts require
  reconciliation; cached URLs cannot bypass quote expiry, and a late provider
  response cannot undo a newer webhook state.
- Before treasury signing, the service re-queries the configured payment
  provider and matches successful status, reference, paid amount, currency and
  funding time against the immutable quote. If funding time is unavailable,
  verification must occur before expiry. Monetary conversion uses integers.
- Treasury and fiat workers durably claim one attempt before contacting a
  signer/provider. A crash or timeout leaves an uncertain attempt for explicit
  reconciliation; it is never automatically replayed. Provider identity and
  monotonic status guards protect payout webhook races. EVM/BTC/Zcash submitted
  treasury transfers remain pending until finality is independently reconciled.
- Unknown attempts and nonfinal treasury transfers currently require operator
  reconciliation. Automated adapter-specific receipt recovery and a complete
  accounting/ledger integration remain production release work; do not reset
  an uncertain intent to a sendable state without reconciling its exact identity.

Webhook handlers reject empty secrets and invalid signatures before inbox
insertion. Valid retries can replace old invalid-signature inbox entries, and
payment-success events cannot reset a completed disbursement. Provider outages
and malformed evidence fail closed. There is no devnet authentication bypass.

The paid-amount contract follows [Paystack transaction verification](https://paystack.com/docs/api/transaction/#verify)
and [Kora server-side charge verification](https://developers.korapay.com/docs/accepting-card-payments-with-apis).

## Settlement authentication

Every intent create/read/payment/signature action, deposit confirmation, and bank
account resolution requires a current Dynamic RS256 bearer token. Bank directory
lookup and health remain public; provider webhooks use their own signature checks.
The browser obtains the token through the existing Dynamic SDK session accessor
and forwards it through `/api/ramp`. The Rust service independently validates the
signature against the configured environment's official Dynamic JWKS, exact
issuer, expiry/not-before, configured audience, environment, and completed auth
scope. This also applies to direct callers and devnet. Neither `x-user-id` nor a
connected wallet authenticates a request.

Required configuration:

- `DYNAMIC_ENVIRONMENT_ID`: the same environment UUID used by the web Dynamic SDK
  (`NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` is accepted as a server-side alias)
- `RAMP_AUTH_AUDIENCES`: comma-separated exact app origins, such as
  `https://app.example.com,http://localhost:3000`; these must match signed JWT `aud`
  claims and never come from a request's Origin, Referer, or Host header

The active Solana wallet, when supplied through `x-wallet-address`, must appear in
that JWT's signed blockchain `verified_credentials`. External or Ledger wallets
that are merely connected, or absent from the authenticated Dynamic account, are
rejected. Multisig/dWallet deposit sources are instead bound to the authenticated
intent by the separately verified intent-specific on-chain reference.

The database owner ID is `UUIDv5(Dynamic environment UUID, JWT sub bytes)`. Old
client-generated wallet UUIDs are deliberately not accepted or auto-migrated:
unauthenticated historical records cannot prove ownership. An operator must
review and reconcile existing pending intents before rollout; never attach them
to a new identity based only on a supplied address/UUID. Existing sessions need a
full Dynamic token containing wallet credentials when a selected wallet is sent.
No new Dynamic API key, grant, paid provider, or authentication bypass is needed.

Token validation contract follows Dynamic's [JWT claims documentation](https://docs.dynamic.xyz/authentication-methods/auth-tokens)
and [server-side verification guidance](https://docs.dynamic.xyz/authentication-methods/how-to-validate-users-on-the-backend).
