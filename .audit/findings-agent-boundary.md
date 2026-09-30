# Agent API and executor audit — 2026-09-30

Scope: local source review and stubbed unit tests only. No deployed service probes,
wallet operations, real key reads, pushes or deployments were performed. Findings
apply to the devnet/testnet implementation; those networks do not remove the
need for production-equivalent authorization and replay controls.

## Fixed in this working tree

| Finding | Severity | Change and evidence |
| --- | --- | --- |
| Owner approval action substitution | High | The old signature rendered the human summary but omitted the machine action. `ownerApproval.ts` now uses an explicitly versioned v2 message with domain-separated, unambiguous JSON binding for action, wallet, agent, target, time and every detail. `ownerApprovalVerification.test.ts` reproduced action substitution and unsigned truncated details before the fix. |
| Legacy signatures silently trusted as authorization | High | `signatureVersion: 2` is required. Legacy stored approvals remain readable but cannot authorize new actions or active automatic grants. New browser signatures mark v2. No old signature is reinterpreted as v2. |
| Malformed signing input crashed verification | Medium | `ownerApprovalVerification.ts` validates the signature/time and returns false for malformed fields. Regression covers invalid dates/details/string fields. |
| Status-only activation bypassed grant approval | High | Both session creation and status transitions now call centralized `sessionAuthorization.ts`; active grants require a verified signed grant. Regression reproduced creation and paused-to-active bypass. |
| Revoked/expired sessions could be revived or expanded | High | Terminal state cannot be changed; existing grant identity, time/risk bounds and policy binding are immutable. Changed grants need a new identity and approval. Expired active transitions reject. |
| Prepared automatic proposal remained executable after grant pause/revoke/expiry/staleness | High | Automatic execution now requires a current `allowed` policy evaluation. Local execution repeats that requirement within its persistence validation. Migration checks reject legacy stored grants and grants whose start time is in the future. |
| Resaving terminal proposals restored mutable status and allowed trade replacement under an existing approval ID | High | Existing trade fields are immutable; executed/rejected/expired proposal state is preserved on retry. Regression tests reproduced rejected-state resurrection and same-ID notional replacement. |
| Concurrent Python retries invoked the venue twice | High | Account mutations are serialized through the full operation, with operation+request fingerprints. Same key/different payload or operation rejects. Four adversarial tests reproduced duplicate execution, payload replay, cross-operation replay and blind retry after ambiguous failure. |
| Ambiguous executor failure was retried as a new venue operation | High | Process-local uncertain-outcome tombstones now require reconciliation rather than resubmitting. This is deliberately not described as restart-safe. |
| Repeated emergency pauses reused the first cancellation receipt forever | High | Each kill-switch invocation receives a new cancellation identity. The old fixed per-wallet key returned a cached first cancellation after new orders existed. |
| Setup recovery could submit an order without storing its submitted receipt | High | `serverExecutionRequests.ts` now allows non-submitted setup/adapter states to advance to submitted while keeping submitted records terminal. Regression covers waiting-for-setup → submitted and attempted downgrade. |

## External-execution containment and bridge

With explicit user approval, all legacy external order/settlement/kill-switch helpers now fail before network mutation. Configured readiness is `authorization_required`, with no environment bypass. The v2 canonical order/threshold/exclusive-account/risk/durable-delivery/protection bridge is implemented against trusted ports and covered by mocked adversarial tests. It remains disconnected until real authority, account registry, delivery ledger, protective-order and close-authorization adapters are implemented and verified. See `docs/architecture/agent-venue-bridge.md`. This contains external execution risk; it does not resolve the server-state privacy/membership issues below.

## Original findings and remaining integration blockers

### 1. Same-origin checks were not authentication (High; private routes now authenticated)

`src/app/api/agent-state/[name]/route.ts` GET/POST, agent-autonomy, and venue
routes rely on `assertSameOrigin`. A scripted caller can supply matching Host and
Origin. The state API permits profile/policy/kill-switch/proposal mutations and
reads for a supplied display wallet name. No authenticated subject is checked.

The companion member-access patch now requires verified Dynamic bearer identity plus fresh program-owned governance membership, and approval recording checks the signature signer against the full current member set. Matching Origin alone no longer grants private access.

`ownerApprovalVerification.ts` by itself proves control of the submitted `approvedBy`
public key, not membership in the target shared wallet. Before the member/signer gate, an attacker could sign a
v2 approval using their own key and claim any wallet name; current protected routes reject that request. The new signature
format fixes substitution; it does not fix wallet authority.

A JWT alone would establish a user identity, not threshold authorization for a
shared wallet or ownership of the configured exchange account. The trusted
boundary must resolve a canonical wallet PDA, verify member/role/threshold or
an existing typed grant, and bind the actual account and action.

### 2. Owner approval IDs are not exact typed-action commitments (High)

Server checks match action/agent/target ID. The first session payload is not
reconstructed from a signed structured grant, so arbitrary first-use bounds can
still be paired with same-ID human details. Approvals have no server challenge,
expiry, single-use consumption or revocation epoch. An old automatic-trading
approval can be reused to enable the flag again. The immutable-field fix prevents
subsequent replacement, not this first-use gap.

### 3. Real on-chain authorization is disconnected from venue submission (High)

The program has real typed session, risk-policy, trade-approval and settlement
paths. `programs/clear-wallet/src/instructions/typed_agent.rs` verifies threshold
proposal readiness, payload/envelope, program-owned PDAs, session/risk identity,
active/unexpired grants, venue/market/leverage and cumulative notional; it
atomically reserves spent/open notional and marks the proposal executed.

The Next `AgentServerExecutionRequest` carries no wallet PDA, on-chain proposal
PDA, session ID, canonical commitment or trusted receipt. Manual/automatic
submission forwards mutable JSON to one environment-configured account.
Client `clearSignV2.onchainProposal.status`, session `onchain` and `riskOnchain`
fields are not independently read or verified by the venue route. The Python
executor trusts the shared bearer token and per-order caps.

### 4. Venue risk is not the risk counted by the policy gate (High)

`serverStateSupport.riskSnapshotFromState` reads `state.executions`, which only
permits paper venues. Real testnet fills are recorded separately in
`serverExecutionRequests`. Account positions, reserved venue orders, cooldown
and realized venue losses therefore do not feed this gate. Public venue
snapshots exist for presentation/reconciliation but are not enforced before
submission. The configured account is shared across all caller wallet names.

The Python market-order implementation does not place stop-loss/take-profit
orders even when the proposal policy requires them. The on-chain risk ledger
is cumulative whereas UI policy calls its cap daily. The current on-chain
schema also does not enforce session start time, open-position count or
cooldown; it only commits a nonzero risk-check hash rather than independently
verifying market evidence.

### 5. First-use signal registration lacked owner authentication (High; member gate now added)

`serverInbox.registerAgentSignalKey` protects replacement using an existing
management-key hash, but first registration previously accepted caller-chosen
management/signal key for any wallet/agent. Redis GET followed by SET is not
atomic, so concurrent first registration can overwrite a competing claim.
The companion route patch now requires current member authentication for management/registration and v2 HMAC binding to canonical wallet/agent/deployment for ingestion. Memory nonce receipts persist 24h independently of deletable inbox items. Allowed-origin headers remain only abuse hints. Redis registration GET–SET still requires atomic conflict handling for simultaneous competing member updates.

### 6. Durable state updates and delivery are not transactional (High)

`statePersistence.ts`, inbox and execution ledger use GET–modify–SET. Concurrent
Redis workers can lose updates or overwrite a new pause with an older snapshot.
Inbox signal idempotency claims are created before inbox persistence, so a
failed write can leave a claimed-but-missing signal. Replay records are coupled
to capped UI histories (50 requests / 250 proposals), not a separate durable
consumption ledger. Python cache/tombstones still reset on restart. Atomic
leases/CAS and venue reconciliation are required for a complete guarantee.

### 7. Storage identity can collide or outlive an account switch (Medium/High)

Server state formerly used display wallet names and colon-concatenated inbox/execution identities. It now requires a canonical request context and stores only new v2 keys derived from the deployment, wallet PDA and unambiguous JSON tuples. Six tests cover missing/mismatched scopes, same-name/PDA isolation, colon-collision isolation, old Redis key quarantine, concurrent scopes and provider rotation with different-genesis separation. Local state has now been changed to v2 subject+canonical-PDA namespaces, with locked/remounted descendants, old-snapshot write rejection, scoped setup/delegation/feedback/compliance stores, and preserved unassigned legacy bytes. Explicit ownership-confirmed recovery copies only inactive profile text. Six focused tests cover isolation, login-lifetime invalidation and migration. Legacy name-only Redis data is preserved unassigned; no automatic ownership migration or deletion is performed.

## Minimal complete typed bridge

1. Identify state and requests by chain, program and canonical wallet PDA. A name
   is display data, never the authorization/storage identity.
2. Establish an authorized wallet-to-venue-account/API-wallet binding. The
   current canonical route is only `venue:orderType`; it does not bind the
   account, leverage mode, slippage or protective-order behavior. Add an explicit
   versioned descriptor commitment (the existing route field is limited to 96
   bytes), independently reconstructed by the trusted executor. Old descriptors
   must not acquire new meaning.
3. Extend the trusted Rust execution service to consume a proposal PDA and
   rebuild exact canonical trade fields. Verify committed/finalized chain
   execution plus current session/risk state immediately before handoff. Reuse
   the existing typed grant/risk/trade/settlement program checks; never trust a
   browser status flag or plain owner-confirmation record instead.
4. Reserve a durable account-scoped delivery key before venue mutation. Derive
   the venue client order ID from canonical authorization identity; reject
   changed-byte retries and reconcile uncertain results before resubmission.
   Keep receipts independently of presentation-history limits.
5. Reconcile actual account positions, pending delivery reservations and fills;
   block on unavailable/stale/mismatched evidence. Define whether accounts are
   isolated per wallet or use a reviewed shared-account allocation policy.
6. Define and authorize closing separately from post-fill accounting. Query
   native fills independently, then use the existing threshold settlement action
   and replay receipt to update exposure/loss. Read proof status and exact wallet/session/action/artifact binding from chain. The current PATCH checks generic chain status but does not establish that exact binding.
7. Route UI and automation through the same trusted boundary on every network.
   Fully automatic agent signing would require a separately designed delegated
   signer mechanism; current typed trade authorization still requires the
   configured wallet threshold.

Relevant reusable frontend hooks: `useAgentTypedSessionGrant`,
`useAgentTypedRiskPolicy`, `useAgentTypedClearSignApproval`, and
`useAgentTypedTradeSettlement`. Reusable backend endpoints are the four
`/wallets/{name}/proposals/{proposal}/typed-agent-*` routes in
`apps/api/src/proposals.rs`. The current generic typed execution helper resolves
wallets by name, so the bridge also needs canonical-PDA support there.

## Verification coverage

| Boundary | Verification |
| --- | --- |
| Approval message/version/substitution/malformed input | New adversarial unit tests; failures reproduced before source changes |
| Session/proposal transitions, persisted legacy grants, future start | New server tests; bypasses reproduced before source changes |
| Automatic pause/revoke/expire/stale interruption | Stubbed/local server tests |
| Setup recovery receipt transition | New ledger test, failed before fix |
| Kill-switch identity | Builder regression, failed before fix |
| Executor concurrency/replay/uncertain outcome | 12 Python unit tests, four new adversarial failures reproduced before fix |
| Existing agent behavior | Final combined `src/lib/agents` + `src/features/agents`: 68 files / 366 tests passed |
| Module boundaries/lint | Frontend architecture and focused ESLint passed |
| Whole-tree TypeScript | Clean `tsc --noEmit --incremental false` passed on the final checked tree |
| Deployed auth, live exchange, Redis concurrency, Solana deployment | Not executed; no claim of live or end-to-end validation |

## Final verified identity scope

The final storage/HMAC namespace uses trusted Connection-discovered genesis plus program ID, not RPC URL. Optional configured genesis pins fail closed on mismatch. Browser scope includes that genesis and key/remount lifecycle; same-account re-login invalidates prior snapshots. Provider-rotation and different-genesis regression tests pass. Private-member authentication and signer-membership details are documented in `docs/security/agent-api-authorization.md`.
