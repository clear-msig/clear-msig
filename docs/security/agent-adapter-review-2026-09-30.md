# Agent adapter and control-flow review — September 30, 2026

This is a local implementation checkpoint, not authorization to enable trading.
No source changes were pushed, no deployment/configuration was changed, and no
wallet, account, credential, order, or payment was created. Paystack/Korapay and
all execution gates remain. The original ClearSig palette is preserved.

## Implemented and verified

- **Finalized canonical authority reader:** `serverSolanaTradeAuthority.ts` uses
  a server-owned RPC and pinned genesis/program. It reads the typed proposal,
  then a consistent finalized proposal/wallet/intent/session/risk snapshot with
  `minContextSlot`. It verifies ownership, bounded layouts, derived PDAs and
  bumps, threshold bitmaps, and recomputes the exact trade payload and v4
  envelope using the repository's Rust encoding. Changed protective orders,
  account, notional, action identity, policy, or expiry cannot reuse approval.
  Synthetic RPC/account fixtures cover wrong chain/owner, stale/changing
  snapshots, invalid threshold/PDA/status/layout, and changed order bytes.
- **Durable venue storage:** `serverVenueRedis.ts` implements atomic Lua-backed
  reservations and immutable reviewed initial wallet/venue/API-address bindings.
  An account cannot be shared across wallets, roles, or chain deployments using
  the same venue registry. A persisted handoff precedes the send capability.
  Expiry and lost responses remain uncertain, never automatically sendable.
  Receipts complete idempotently; changed commitments and stale leases fail.
- **Recovery:** `reconcileExisting` only reads an existing recorded delivery and
  independently reconciles it. Expired/revoked grants do not prevent accounting
  for an already-sent order, and recovery cannot reserve or submit a new order.
  Expiry/risk freshness is rechecked after the durable handoff's network wait.
- **Real storage integration:** official Redis 7.2.11, source commit
  `d4c381df7a729c06a5207c4f18d804febe956dc4`, compiled outside the repository.
  Tests use loopback-only temporary servers, AOF, `appendfsync always`, and
  `noeviction`. Concurrent claims, account collisions, pre-handoff release,
  database restart, uncertainty and duplicate completion pass.
- **Actual component flow:** agent decision disclosure grows from 28px to 44px;
  proposal/close controls grow from 32px to at least 44px. Chromium at 320, 390
  and 1440px passed keyboard disclosure, pending repeated-click suppression,
  blocked recheck, paper action, declined-state controls and no overflow/errors.
  These were actual `DecisionJournalSummary`/`ProposalActions` components with
  synthetic props/callbacks in an isolated checkout; all external requests were
  blocked. They were not live authentication, signing or trade tests.

## Validation

`npm run verify` with the local Redis integration variables set passed all
178 Vitest files / 1,066 tests, plus 14 script tests. Intent, metadata,
architecture, ESLint and TypeScript checks passed. Without those variables,
the five Redis integration cases are explicitly skipped rather than mocked.
Production compilation passed and generated all 50 static pages. The existing
bundle gate still fails: largest chunk 535.7 kB gzip against 506; worst standard
authenticated route 1,009.0 kB against 971; external-wallet runtime 1,137.9 kB
against 1,100; legacy Turnkey runtime 998.8 kB against 954. These limits were
not changed. Full logs are included in the portable handoff.

No root Rust/SBF source changed after the original validated `7f804704` snapshot.
Those checks were not rerun; this environment still lacks that toolchain. The
new TypeScript reader's binary/hash mirrors were checked against the repository
Rust source, but a new cross-language/live-program integration run remains a
release gate. All external production/provider/authenticated tests remain unrun.

## Remaining code gates (not solved by credentials)

1. A real committed-limit resolver for daily loss, cooldown, open-position and
   take-profit policy. Existing generic typed policy bytes do not encode all
   these fields. The reader requires this adapter and has no permissive default.
2. Native venue exposure/risk and exact entry/stop/take-profit reconciliation;
   proven atomic protected entry. Hyperliquid batch/grouping is not assumed to
   guarantee that property. The existing unprotected Python executor stays
   disconnected. Unsupported protection must remain gated.
3. Canonical v2 order preparation plus authenticated route composition of the
   new reader/registry/ledger; no legacy order bytes are silently reinterpreted.
4. Native settlement evidence, immutable artifact consumption and canonical
   finalized settlement reader. A protection receipt is not PnL evidence.
5. Separate threshold-authorized close/emergency actions and reviewed binding
   rotation/recovery. Neither is granted by a session or post-fill settlement.

## Configuration / live verification gates

- Trusted pinned RPC/deployed program compatibility; approved immutable initial
  dedicated-account assignments; durable shared Redis with persistence and no
  eviction. Configuring these cannot enable the gated execution routes.
- Auth/provider credentials and real device/wallet/provider integration tests;
  settlement service executable quote/auth configuration and trusted deposit
  evidence. No quote-provider/business-model replacement was made.
- Existing secured Dynamic SDK bundle budgets remain failing. The SDK remains
  intact; thresholds were not relaxed and no vulnerable downgrade/deep import
  was introduced. A genuine headless migration is separate substantial scope.

## Test reproduction

```
CLEARSIG_TEST_REDIS_BIN=/absolute/path/redis-server \
CLEARSIG_TEST_REDIS_CLI=/absolute/path/redis-cli npm run verify
```

Run from `apps/web`. Redis tests create their own temporary directory and port;
never pass a production database. The handoff includes the isolated component
fixture and browser script/results, with their synthetic scope labelled.
