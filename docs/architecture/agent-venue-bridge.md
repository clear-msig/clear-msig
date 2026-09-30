# Agent venue authorization bridge

Status: contract implementation and mocked tests; external execution is blocked.
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

Required reviewed implementations before enabling any route:

- Finalized authority reader pinned to the deployment's chain/program, checking
  actual owner/layout/PDA and canonical bytes, with an explicit finality policy
- Exclusive canonical-wallet/venue-account registry with approved assignment,
  rotation and recovery semantics; display names are never registry identity
- Durable atomic delivery ledger with account-scoped risk reservations, changed
  payload rejection, non-evicting consumption records and restart reconciliation
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

Storage and signal domains use the genesis hash discovered through the fixed server Connection plus the configured program ID. The genesis reader validates the returned hash, caches by Connection, evicts failed reads and checks NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH when configured. Browser local scope also uses the resolved genesis, with endpoint changes invalidating the wallet query. Provider/API-key rotation on the same chain preserves the namespace; another genesis is isolated. The production execution bridge still requires a real pinned-chain canonical authority reader, not merely this identity discovery.

`serverSettlementProof.ts` defines the exact finalized threshold settlement predicate, with wallet/policy/session/execution/artifact/oracle/closed-size/PnL/sequence checks. Settlement proof promotion remains blocked until a real trusted reader and immutable native-evidence claim store are wired into that predicate.
