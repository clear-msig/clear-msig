# Agent venue authorization bridge

Status: real finalized Solana reader and Redis registry/delivery ledger implemented locally; external execution remains blocked. Offline RPC fixtures and real local Redis integration tests cover these adapters; no live provider execution is claimed.
This gate applies to testnet as well as production. Setting executor credentials
cannot enable it. No live accounts, grants, keys, or orders are created by this
implementation.

## Accepted design

Each canonical ClearSig wallet gets its own dedicated venue account. Every
external trade requires the wallet's configured approval threshold. A bounded
session alone is not delegated permission to bypass the per-trade threshold.
Stop-loss protection is required, and an adapter without verified atomic entry
and reduce-only protection support cannot submit.

## Implemented contract

`apps/web/src/lib/agents/serverVenueOrderContract.ts` defines an explicit v2
order descriptor. It binds chain genesis, program, wallet PDA, action/session/
agent identity, policy/risk commitments, funded account, API wallet, market,
side, exact u128 atomic USD size, isolated leverage, maximum slippage, stop-loss,
optional take-profit and expiry. The route `hl-order-v2:<sha256>` fits the
existing canonical v4 route field. Legacy `venue:orderType` routes remain legacy
and are rejected by the new bridge; existing bytes are not reinterpreted.

`serverVenueBridge.ts` implements the orchestration against trusted server ports:

1. Validate the descriptor against the pinned deployment and exclusive account
   registry, then reconstruct its exact canonical action fields.
2. Require finalized, program-owned, threshold-executed v4 AgentTradeApproval and
   current matching session/risk state. Existing on-chain reservation/accounting
   is reused; the bridge does not replace it with a frontend approval flag.
3. Claim a durable delivery identity keyed by chain/program/wallet/proposal. The
   order commitment is stored under that key, not added to the key, so changed
   bytes cannot produce a second delivery identity for the same proposal.
4. Recheck authority after the account-scoped reservation and again after venue
   risk observation. Block on revoked/expired/stale grants, exceeded on-chain
   loss/budget, stale or unknown venue state, open/pending position limits,
   cooldown, daily loss and incorrect protection-price direction.
5. Issue an ephemeral unforgeable capability to the trusted protected-order
   adapter. Reconcile entry and protective orders independently from native
   venue reads before accepting a receipt.
6. Persist the receipt before reporting success. Any uncertainty after an
   attempted side effect becomes a durable uncertain record. Reconciliation may
   complete it, but neither timeout nor missing evidence allows a second order.

The bridge ports are injectable for offline contract tests. They are not wired
into API routes and do not authorize real transactions by themselves.

## Production prerequisites

`serverVenueExecutionGate.ts` lists the blockers. `serverExecutionAdapters.ts`
reports `authorization_required` even with valid credentials. Legacy direct
order, settlement and kill-switch helpers throw before `fetch`.

Implemented adapters, still requiring reviewed integration and deployment configuration:

- `serverSolanaTradeAuthority.ts`: pinned genesis/program, finalized multi-account
  snapshot with `minContextSlot`, owner/layout/PDA/bump verification, exact v4
  payload/envelope recomputation, threshold bitmap and session/risk identity.
  No request selects the RPC/deployment. Tests use synthetic account bytes;
  live deployed-program compatibility is not yet verified.
- `serverVenueRedis.ts`: atomic immutable initial wallet/account/API-key-address
  bindings, including cross-role/cross-deployment account collision rejection.
  Rotation/recovery is deliberately unsupported pending an explicit workflow.
  No API exposes registration and no account/credential is provisioned.
- The same adapter provides atomic reservations, durable pre-send handoff,
  changed-payload rejection and receipt completion. Lease expiry becomes
  uncertain and never authorizes another send. All records are non-expiring;
  the service must use durable persistence, no eviction, and the same venue
  registry across deployments. Local integration tests use actual Redis AOF,
  `appendfsync always`, `noeviction` and a database restart.
- `reconcileExisting` may resolve a previously recorded uncertain delivery after
  grant expiry/revocation without claiming or submitting an order. A lost storage
  response cannot release a possibly persisted handoff.

Still-required code before enabling any route:

- Authoritative resolution of venue limits (daily loss/cooldown/open positions/
  take-profit) bound to approved policy. Existing typed policy bytes do not
  encode all of these fields; `resolveCommittedLimits` is mandatory with no
  default. A callback returning an echoed commitment is not a finished adapter.
- Canonical v2 order preparation and authenticated server composition of these
  adapters; existing legacy order routes must not acquire new v2 semantics
- Native venue adapter that truly guarantees atomic protected entry and verifies
  exact reduce-only stop/take-profit orders through independent reads
- Separate threshold-authorized close/emergency-stop contract. Post-fill
  AgentTradeSettlement is accounting approval, not advance permission to close

These prerequisites cannot be satisfied by environment booleans. A configured
URL/token or a successful health probe proves connectivity only. The existing
Python executor submits unprotected legacy market orders; it is not a v2
protected-order adapter and must not be connected to bypass the gate.

## Reusable on-chain paths

The existing typed agent session, risk-policy, trade-approval and settlement
endpoints in `apps/api/src/proposals.rs` and program instructions in
`programs/clear-wallet/src/instructions/typed_agent*.rs` provide the foundation.
The current name-based Rust resolver needs canonical-PDA resolution for this
bridge. The frontend hooks already prepare v4 threshold proposals but must send
canonical identifiers/commitments, not their local `onchain.status` snapshots,
to the eventual trusted bridge.

The on-chain ledger tracks cumulative loss and notional. Daily loss, cooldown,
position count, protection order correctness and current native venue exposure
must be derived/enforced by trusted adapters or added through explicitly
versioned on-chain changes. A nonzero risk-check hash is not proof that those
checks happened.

## Local state migration

Agent browser state is separately scoped to SDK subject plus canonical wallet
PDA. That subject is a privacy namespace, not server authorization.
`AgentLocalStateBoundary` locks/remounts descendants across identity changes;
repository snapshots from another scope cannot write into the new account.
Legacy unscoped bytes are never automatically assigned to a user. Explicit
owner-confirmed recovery copies only inactive profile text; keys, approvals,
budgets, venue assignments and trade history stay preserved separately.

Server routes now require a signed Dynamic session and fresh program-owned governance membership for private access. Storage runs in a mandatory canonical-wallet request context and uses new v2 namespaces; old name-only Redis records are preserved unassigned, never inferred to belong to the current caller. Public profile reads resolve the canonical wallet separately and remain publication-filtered.

Storage and signal domains use the genesis hash discovered through the fixed server Connection plus the configured program ID. The genesis reader validates the returned hash, caches by Connection, evicts failed reads and checks NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH when configured. Browser local scope also uses the resolved genesis, with endpoint changes invalidating the wallet query. Provider/API-key rotation on the same chain preserves the namespace; another genesis is isolated. The production execution bridge has a separate pinned-chain canonical authority reader, but it is not wired into execution routes; discovery alone remains insufficient.

`serverSettlementProof.ts` defines the exact finalized threshold settlement predicate. `serverSolanaSettlementAuthority.ts` now implements its pinned finalized v4 account reader; `serverSettlementEvidenceStore.ts` atomically consumes independently verified native closing-order evidence. Promotion remains blocked on opening-execution allocation, accounting semantics and reviewed route composition. Native evidence is not silently converted into a protocol artifact hash.


## Evidence and operational limits for the local adapter slice

RPC methods follow the official [getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts)
and [getGenesisHash](https://solana.com/docs/rpc/http/getgenesishash) contracts.
Binary/hash layouts mirror the checked-in Rust state structs and
`crates/clear-msig-signing/src/hashing.rs`. This is a trusted RPC verification
adapter, not a Solana light client. Program identity/version and RPC trust must
be reviewed at configuration time; no mainnet-specific guard is weakened.

Redis integration tests are opt-in with `CLEARSIG_TEST_REDIS_BIN` and
`CLEARSIG_TEST_REDIS_CLI`, pointing to local official Redis binaries. Tests spawn
only loopback servers with temporary data directories; they never use application
Redis credentials. Default tests explicitly skip this integration suite when
those binaries are absent. There is no in-memory storage fallback in production.

Native closing-order verification and immutable evidence consumption now exist,
as does the finalized canonical settlement reader. A protected order receipt is
not settlement/PnL evidence, and these changes do not promote synthetic receipts
to trusted settlement. See `docs/security/completion-boundary-2026-09-30.md` for
the venue capability findings and exact remaining product/configuration gates.

## Versioned limits data (local continuation)

`venueLimitsManifest.ts` now supplies strict required-field validation, exact USD
amount encoding, a domain-separated commitment and context binding checks. See
[the v1 specification](venue-limits-manifest-v1.md). This does not make the
existing resolver authoritative or enable routes. Canonical signing/rendering
and program-recognized descriptor integration remain code work; no legacy
policy/risk hash is reinterpreted. Execution mode awaits the user decision and
daily reset requires an explicit policy timezone. Existing gross-PnL and
entry-fill cooldown semantics are preserved.
