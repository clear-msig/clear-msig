# Agent Trading Vault MVP Plan

This plan locks the first implementation path for ClearSig v2. The core
constraint is modularity: agent trading must grow beside the current wallet,
member, proposal, policy, Ika, Solana, and Encrypt flows without breaking them.

## MVP Principle

Proposal-only is the safest entry point, but it cannot be the whole MVP.
Trading entries can disappear while humans are offline, so a useful MVP must
also support bounded execution sessions.

The MVP therefore has two modes:

- Propose-only: agent submits trade intent, humans approve.
- Bounded session: humans pre-authorize a narrow trading window, and the agent
  can act without per-trade approval while it stays inside policy limits.

Anything outside the session or policy limits is blocked or escalated back to
human approval.

Product language:

- Agent Trading is the ClearSig-governed trading system for users. The user
  chooses the agent, allowance, markets, venues, size, leverage, stop rules,
  kill switch, and approval requirements.
- Automatic Trading is an agent taking trading actions on the user's behalf
  inside those predetermined ClearSig rules. That includes preparing ideas,
  opening allowed trades, closing trades at approved exits, and recording the
  reasoning and result.
- Creator-owned agents are not hosted or trained by ClearSig by default.
  Agent creators can use any model, framework, training data, market data,
  research pipeline, or hosting provider they choose. ClearSig receives their
  signed trade decisions and decides whether those decisions are allowed to
  execute for each user.
- ClearSig's role is the permissioned executor, identity/registry layer,
  evidence journal, audit trail, leaderboard, allocation gate, and payout
  accounting layer. The incentive for creators is to improve their own agents
  because better performance can attract user allocations and future
  performance fees.

## Non-Negotiable Boundaries

- Agents never receive raw wallet custody.
- Agents never bypass ClearSig policy.
- ClearSig does not need to host a creator's agent runtime, private model,
  data pipeline, exchange keys, or training infrastructure.
- Solana remains the authority layer.
- Ika remains the cross-chain signing and execution direction.
- Encrypt remains the privacy/policy data path.
- First execution targets must be mock or testnet.
- Existing wallet/member/send/proposal flows must keep working unchanged.

## Module Boundaries

Frontend domain modules:

- `frontend/src/lib/agents/types.ts`
- `frontend/src/lib/agents/policy.ts`
- `frontend/src/lib/agents/encryption.ts`
- `frontend/src/lib/agents/scoring.ts`
- `frontend/src/lib/agents/storage.ts`
- `frontend/src/lib/agents/mockVenue.ts` later

Backend modules later:

- agent identity routes,
- creator-owned agent registry and publishing routes,
- agent proposal routes,
- session grant routes,
- signed agent decision inbox / webhook routes,
- mock venue execution route,
- Hyperliquid testnet adapter.

On-chain later:

- agent session grant account,
- policy hash binding,
- revocation state,
- execution authorization check.

## Phase 1: Pure Agent Domain

Build first:

- agent profile type,
- trade proposal type,
- vault policy type,
- session grant type,
- risk snapshot type,
- scorecard type,
- deterministic policy evaluator,
- Encrypt-ready persistence helpers,
- leaderboard scoring.

This phase must stay pure TypeScript with tests. No app-route dependency.

## Phase 2: Local Prototype UI

Add routes under wallet scope:

- `/app/wallet/[name]/agents`
- `/app/wallet/[name]/agents/new`
- `/app/wallet/[name]/agents/policy`
- `/app/wallet/[name]/agents/sessions/new`
- `/app/wallet/[name]/agents/proposals/new`
- `/app/wallet/[name]/agents/[agent]`

The first UI stores locally, like current pre-alpha policy rules.

Environment reminders for later:

- Encrypt needs `NEXT_PUBLIC_ENCRYPT_GRPC_URL`,
  `NEXT_PUBLIC_ENCRYPT_PROGRAM_ID`, and the current
  `NEXT_PUBLIC_ENCRYPT_NETWORK_KEY_HEX` before the UI can call the live
  Encrypt path instead of the local stub.
- Hyperliquid and Bulk credentials must stay backend-only. Do not put agent
  private keys or API secrets in `NEXT_PUBLIC_*` variables.

## Phase 3: Realistic MVP Behavior

Implement both flows:

- agent proposes and humans approve,
- agent executes inside a bounded active session.
- agent strategy playbook defines entry rules, exit rules, risk rules,
  execution protocol, allowed markets, and kill switch rules.

The second flow is what makes the MVP market-realistic. A vault can say:

> Agent A may trade BTC-PERP and ETH-PERP on mock perps, up to $500 notional,
> max 2x leverage, stop loss required, one open position, for 24 hours.

If the proposal violates any rule, it is blocked.

## Phase 4: Mock/Testnet Execution

Start with a mock perps venue:

- open position,
- close position,
- update PnL,
- emit audit event,
- update scorecard.

Then add Hyperliquid testnet or another perps venue only after the evaluator
and session model are stable.

Current local slice:

- agent strategy playbooks can be created and edited,
- bounded session execution requires an agent strategy playbook and must pass
  strategy-aware checks,
- proposals can be approved or rejected,
- active sessions can turn an allowed signal into an open paper trade,
- approved proposals can be paper-executed after a final hard risk check, even
  without an active session. Human approval clears approval-needed status only;
  it never bypasses hard limits such as leverage, market, notional, expiry,
  kill switch, cooldown, or open-position limits.
- mock executions are recorded locally,
- open paper trades can be closed with realized PnL,
- each agent has a detail page for profile, recovery controls, sessions,
  signals, paper trades, scorecard, and audit log,
- audit events are recorded locally,
- scorecards update from proposal/action transitions and closed paper trades.
- external agents can submit signals into `/api/agent-signals/[wallet]/[agent]`
  after the UI registers the agent signal key.
- external bot signals must include `clientSignalId` so retries do not create
  duplicates, and `submittedAt` so stale signals are rejected and import expiry
  stays anchored to the original market signal time.
- imported bot signals keep their retry ID on the saved trade signal, so
  repeated imports cannot create duplicate trade signals or duplicate paper
  trades.
- queued server signals are previewed against current ClearSig risk before the
  user imports them.
- queued bot signals are visible from the Agent Trading overview and the agent
  detail screen, so users know when a bot has sent something to review.
- connection pages can enable auto-review for bounded sessions. While the page
  is open, ClearSig checks queued bot signals and only imports signals already
  allowed by the active session and risk limits; blocked or approval-needed
  signals stay queued.
- the Agent Trading overview and each agent detail page expose a kill switch
  that pauses all agent trading immediately and records the change in the agent
  log.
- open paper trades can be closed one by one, or flattened in one action from
  the Agent Trading overview or an individual agent detail page.
- execution now uses a venue adapter gate. Paper venues can open locally, while
  Hyperliquid testnet remains approved but waits for the backend execution
  adapter instead of being falsely marked as locally opened.
- `/api/agent-execution/[venue]` now exposes server-adapter readiness and
  validates server execution requests. It refuses live/testnet submission until
  backend-only venue keys are present and the exchange adapter is actually
  connected.
- the Agent Trading overview shows live venue setup status so users know why a
  venue is ready for paper trading, waiting for backend setup, or connected.
- approved backend-required signals now expose a "Send to venue" handoff. The
  handoff validates the request and returns a setup/adapter message, but it does
  not mark an exchange order as placed until the server adapter actually
  succeeds.
- valid venue handoffs are now recorded in a server-side request ledger with
  duplicate protection per proposal and venue. In production this can use the
  same Upstash Redis backing as the signal inbox; locally it falls back to
  memory.
- signal keys can only submit bot signals. Reading, refreshing, registering, or
  clearing the inbox requires the local ClearSig management key so a bot cannot
  manage the inbox with its submit key.
- the signal inbox uses `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` when present; otherwise it falls back to local
  in-memory storage for development only.

## Phase 5: Backend Persistence

Move local agent state to backend once the shape is stable:

- durable agents,
- durable proposals,
- durable sessions,
- durable scorecards,
- event log.

The backend should still treat execution as policy-gated. It should not trust
an agent-submitted request without re-evaluating the policy server-side.

Phase 5 has started with the execution adapter boundary:

- server execution readiness is separated from browser paper trading,
- Hyperliquid testnet requires backend-only credentials,
- request validation is centralized before any future exchange call,
- venue handoff attempts are traceable server-side and idempotent,
- the current route returns not-configured or not-implemented instead of
  pretending to place live orders.
- backend agent state now has a first durable repository and
  `/api/agent-state/[wallet]` route for agents, policies, sessions, proposals,
  scorecards, leaderboards, and audit events. It uses Upstash Redis when the
  existing Redis environment is present and local memory in development.
- proposal persistence and human approval re-run the ClearSig policy evaluator
  server-side, so an agent-submitted status is never trusted without current
  backend risk, policy, session, and kill-switch checks.
- the browser now has a backend state client for the agent-state route. Agent
  registration, strategy edits, risk limits, session grants, manual signals,
  imported bot signals, proposal approvals/rejections, session revocation, and
  kill-switch changes are saved locally first and then mirrored to backend
  persistence with clear fallback messaging if the server store is unavailable.
- the Agent Trading overview shows backend persistence status and whether the
  durable store is Redis-backed or local-memory development storage.
- the Agent Trading overview now points retail users to a funding screen where
  agent track records become simple raise, fund, lower, keep, or review
  allowance recommendations. Recommendations are still bounded by the current
  vault policy and route through the owner-approved allowance form.
- trade ideas now carry a structured decision journal. It records why the
  agent wanted the trade, technical/fundamental/news context, risk and exit
  logic, policy-check outcome, and evidence tags. The overview and trade
  history show this explanation so users can judge whether the agent is trading
  logically, not just whether a trade won or lost.
- closed paper trades now generate a structured post-trade review. The review
  records whether the setup won, lost, or went flat, whether the thesis held,
  how risk compared with the plan, and what the agent should learn before users
  compare it for funding or leaderboard placement.
- the Agent Trading overview now has an Agent Scout layer. Active traders scan
  their allowed markets with available market data, rank the best setup, show
  thesis/risk/policy context, and can turn the scout read into a normal
  ClearSig-checked proposal or paper trade.
- automatic trade management can now detect approved stop-loss or take-profit
  exits on open paper trades and close those trades through the same execution
  record path, including post-trade reviews and backend sync.
- paper execution records are now part of backend agent state too. Opening,
  rechecking into, and closing paper trades sync execution records server-side;
  backend risk snapshots use open executions instead of trusting proposal
  status, and closed trades update durable PnL scorecards and audit events.
- server venue handoffs now pass through backend persisted policy state before
  the request ledger accepts them. The handoff route verifies the approved
  signal exists in backend state, rejects request/proposal mismatches, blocks
  stale approvals when current policy or kill switch state fails, and records
  blocked attempts as rejected ledger entries. A rejected attempt can be retried
  after state is fixed without poisoning the proposal/venue idempotency key.
- queued bot-signal imports now have a server-side import boundary. The
  management-key protected inbox route can import selected queued signals,
  evaluate them against backend agent state, persist durable proposals, and
  remove only successfully imported inbox items. Auto-review can ask for
  allowed-only imports so approval-needed or blocked signals stay queued.

## Phase 6: Solana/Ika/Encrypt Hardening

Use Solana for authority:

- vault ownership,
- grants,
- revocation,
- policy hash references.

Use Ika for chain execution direction:

- venue settlement,
- cross-chain account control,
- signed execution artifacts.

Use Encrypt for sensitive policy values:

- allowed markets,
- session limits,
- max notional,
- drawdown limits,
- agent metadata where needed.

Phase 6 has started with policy hash binding:

- vault policies now carry a deterministic SHA-256 commitment over the
  plaintext risk controls that future Solana grants and Ika execution
  artifacts can reference,
- Encrypt-ready policy records preserve that commitment and carry ciphertext
  references. While Encrypt remains pre-alpha passthrough, enforcement values
  stay available to the local/server risk evaluator; real redaction waits for
  a confidential evaluator that can enforce the encrypted controls,
- session grants, trade proposals, and execution records now carry the policy
  hash they were issued or evaluated under,
- backend venue handoff rejects approved signals whose policy hash no longer
  matches the current backend policy, forcing a fresh re-approval before any
  future exchange adapter can submit,
- local paper execution also refreshes a proposal hash during its final risk
  check, so paper records remain tied to the policy version that actually
  allowed the trade,
- active bounded sessions are valid only while their policy hash matches the
  current vault policy. Older or missing commitments require session renewal
  and cannot auto-import or auto-execute signals,
- starting or renewing a session replaces older active authority for the same
  agent, keeping one clear active grant per agent,
- backend paper execution persistence now accepts only one execution per known
  approved proposal, verifies immutable trade fields and policy commitments,
  and refuses fabricated browser execution records,
- owner approvals can now be wallet-signed and verified server-side. Backend
  active allowance persistence requires a matching wallet-signed `grant_allowance`
  approval for the session before the grant is accepted into durable state.
  Browser-only confirmation remains a local fallback for demos, but it does not
  create durable server authority,
- server venue handoffs now require a matching wallet-signed
  `submit_venue_trade` approval for the proposal before the request can move
  past the route boundary. A rejected unsigned attempt can be retried after the
  owner approval is recorded,
- durable trade close records now require a matching wallet-signed
  `close_practice_trade` or `close_all_practice_trades` approval before backend
  P/L, scorecard, and audit state are updated,
- emergency pause remains a public revocation/kill-switch state outside the
  private policy commitment, so it can be toggled immediately even when policy
  controls are encrypted.

## Phase 7: Creator-Owned Agent Network

ClearSig should support a Bring Your Own Agent model before it considers
hosting agent runtimes. Creators can train, fine-tune, prompt, host, or run
their agents anywhere. ClearSig only accepts structured decisions from those
agents and executes for users when the decision passes the user's current
rules.

This is achievable if ClearSig standardizes the boundary:

- **Agent identity:** every published agent has a creator profile, public
  signing identity, endpoint metadata, risk disclosures, supported venues, and
  supported markets.
- **Decision protocol:** external agents submit signed trade decisions, not
  wallet actions. A decision must include market, side, size request, stop,
  target, confidence, thesis, evidence used, data timestamps, and an idempotent
  client signal ID.
- **Evidence journal:** agents may use any model or private data source, but
  the decision sent to ClearSig must explain what evidence influenced the
  trade. ClearSig stores this as the decision journal so users can judge
  reasoning quality.
- **Risk gate:** ClearSig re-evaluates every decision against user allowance,
  market, venue, notional, leverage, stop-loss, take-profit, open positions,
  cooldown, daily loss cap, kill switch, and policy hash. Agent-provided
  status is never trusted.
- **Execution boundary:** the agent never receives user custody or venue
  credentials. If allowed, ClearSig or a protected executor places the order
  and records the execution artifact.
- **Track record:** leaderboard and funding decisions use ClearSig-observed
  behavior: allowed/blocked decisions, opened trades, closed PnL, drawdown,
  stop discipline, duplicate attempts, evidence quality, and post-trade
  reviews.
- **Creator economics:** published agents can later earn a platform/performance
  fee only from user-approved allocations and verified realized performance.
  The creator's off-platform model quality becomes their competitive advantage.

Infrastructure ClearSig needs:

1. Public agent registry with creator identity, disclosures, strategy summary,
   supported markets, and signing key rotation.
2. Signed decision API and SDK examples for common agent stacks. The SDK should
   make it easy for creators to submit decisions from any LLM, quant engine,
   hosted service, local process, or cron runner.
3. Decision schema validation with required evidence, freshness, duplicate
   protection, and per-agent rate limits.
4. Creator dashboard for published-agent status, blocked reasons, fills,
   closed-trade reviews, user allocations, and pending payout accounting.
5. User marketplace pages that compare agents by ClearSig-recorded results,
   not creator claims.
6. Fee accounting design for future real-capital allocations. No automatic
   fee distribution ships until legal, security, tax, and venue reconciliation
   requirements are reviewed.

What ClearSig should not promise in the MVP:

- hosting arbitrary agent code,
- training creator models,
- guaranteeing creator data quality,
- giving agents custody,
- letting agents trade outside user-approved rules,
- ranking agents from self-reported performance.

## Phase 8: Market-Ready Launch Gates

These gates are now locked into the shipping path. They are tracked in code by
`frontend/src/lib/agents/marketReadiness.ts` so the product can distinguish
controlled paper testing, public paper testing, and live-capital readiness.

Locked public-beta build order:

1. Production persistence hard gate. **Completed.**
2. Public agent profile pages. **Completed.**
3. Creator marketplace registry. **Completed.**
4. Real market/news/macro data layer. **Completed.**
5. Notifications. **Completed.**
6. Admin beta dashboard. **Completed.**

Feature discoverability pass: **Completed.** Agent Trading now exposes direct
entry points for marketplace, public profiles, market intelligence, notifications,
and demo setup so testers do not need hidden routes or debug flags to exercise
the shipped surfaces.

Better user onboarding: **Completed.** The Agent Trading overview now leads
with the retail beta path: choose an agent, start trading, browse the
marketplace, and watch trades. Advanced setup surfaces such as manual ideas,
practice allocation tuning, Hyperliquid setup, approvals, feedback, and safety
rules are grouped under an advanced controls drawer instead of competing with
the beginner flow.

Beta journey polish: **Completed.** Start Trading now shows the full public
beta journey in one sequence, keeps practice/testnet labels visible, and
surfaces trust/failure notices for paused trading, missing market data, venue
reconciliation issues, pending venue requests, and protected executor errors.
The Trades and Marketplace surfaces label paper, testnet, and verified-live
evidence separately so testers cannot confuse simulated behavior with real
capital performance.

1. **Production-grade persistence**
   - Public beta requires Redis or database-backed agent state. Browser,
     process-memory, or local-only storage is allowed only for development.
   - Current implementation: production runtime now rejects agent backend state
     reads and writes unless Redis is configured. Memory state remains available
     only for development or an explicit local escape hatch.
2. **Wallet-signed permissions for agent-state changes**
   - Fund-impacting mutations must require owner wallet signatures. This
     includes allowance grants, automatic-trading starts, venue handoffs, trade
     closing, kill switches, and future revocation flows.
3. **Live exchange reconciliation**
   - A trade is not considered verified live performance until ClearSig can
     reconcile exchange fills, positions, fees, funding, closed PnL, and order
     artifacts against the protected venue adapter.
   - Current implementation: venue readiness now returns a reconciliation
     summary for Hyperliquid testnet that compares submitted ClearSig requests
     with live open positions, flags missing exchange order IDs, warns about
     unmatched venue positions, and blocks trust when venue account state is
     unavailable. The Agent Trading overview exposes this as a visible venue
     check.
4. **Creator marketplace**
   - Published agents need creator identity, strategy summary, supported
     markets, supported venues, public profile status, disclosures, and
     signing-key metadata before broad discovery.
   - Current implementation: approved published agents now have wallet-scoped
     public profile pages and a JSON profile API. Draft, pending, paused, and
     delisted profiles stay hidden. Profiles show separated paper/testnet/live
     lanes, public decision journals, recent trades, and ClearSig disclosures
     without exposing owner-only controls or connection secrets.
   - Current implementation: `/agents` and `/api/agent-marketplace` now expose
     a moderated creator registry from an explicit wallet allowlist. The
     registry ranks only approved public profiles, keeps paper/testnet/live
     records separated, supports market/source filters, and avoids scanning
     arbitrary user wallets.
5. **Creator payouts**
   - No payout flow ships for real capital until high-water marks, performance
     fee rules, disputes, taxes, legal review, and venue reconciliation are
     complete.
6. **External agent verification**
   - Submit-only signal keys are a start, but public creator agents need signed
     decisions, verified signing identity, key rotation, freshness checks,
     replay protection, and endpoint review.
   - Current implementation: creator SDK submissions now include an
     `hmac_sha256_v1` signed-decision envelope by default. The signal API
     verifies the signature against the registered submit-only key and rejects
     mismatched signatures before queuing the decision.
7. **Real market, news, and macro data ingestion**
   - The data layer must support provider-neutral prices, funding, open
     interest, volume, news/events, macro context, timestamps, freshness, and
     provider quality controls. Agents must cite what data they used.
   - Current implementation: market-data snapshots now compose into normalized
     market-intelligence snapshots. Hyperliquid supplies live price, funding,
     open-interest, and volume data; configured JSON feeds
     `CLEARSIG_AGENT_NEWS_JSON_URL` and `CLEARSIG_AGENT_MACRO_JSON_URL` can add
     source-attributed news and macro items. Scout reports and trade decision
     journals cite connected news/macro context when available and clearly state
     when those providers are absent.
8. **Paper/live leaderboard separation**
   - Paper, testnet, and verified live records must never be blended. Public
     profiles and allocation recommendations must label the track-record
     source clearly.
   - Current implementation: Agent Library now computes separate Paper,
     Testnet, and Verified live track-record lanes from recorded proposals and
     executions. Users can switch the visible source before comparing score,
     rank, P/L, win rate, trade tape, and allowance recommendations.
9. **Agent notifications**
   - Users need a durable operational notice layer for trades needing approval,
     blocked ideas, open/closed trades, expiring allowances, kill-switch events,
     and marketplace review changes. These notices must outlive transient
     toasts and point users back to the affected agent or trade.
   - Current implementation: the Agent Trading dashboard now derives priority
     notifications from durable agent state, supports local read/unread state,
     and exposes urgent/warning counts with direct links to the relevant
     trading surface.
10. **Compliance disclosures**
   - Users need clear disclosures for simulation, automation, leverage,
     creator-owned agents, performance fees, data limits, and the fact that
     past performance does not guarantee future returns.
   - Current implementation: Start Trading now requires per-wallet,
     per-practice-venue disclosure acknowledgement before automatic trading.
     The disclosure gate covers simulation/testnet limits, automation,
     leverage, creator-owned agents, data limitations, and future creator fees.
11. **Admin moderation**
   - ClearSig needs admin workflows to review, pause, delist, investigate, and
     audit published agents before a public marketplace is open.
   - Current implementation: published agent profiles now carry marketplace
     moderation status. Profiles start as pending review, can be approved,
     paused, or delisted from the agent detail page, and every moderation
     change is written to the agent audit log.
   - Current implementation: `/app/wallet/[wallet]/agents/admin` now provides
     a beta operator dashboard with launch blockers, venue health, moderation
     queue, risky agents, tester feedback, and market-readiness checks.
12. **Abuse and rate-limit controls**
   - Agent APIs need origin checks, per-agent rate limits, signal-key controls,
     bounded body sizes, freshness checks, duplicate protection, signed
     decisions, and abuse monitoring.
   - Current implementation: signal registration can now store an endpoint
     origin allowlist. Signal enqueue rejects missing retry metadata, stale or
     future timestamps, disallowed origins, and per-agent bursts while keeping
     idempotent duplicate retries harmless. The signal API returns explicit
     abuse flags and 429s rate-limited submissions.

## Demo-Ready Build Order

The next work stays in this order so the product proves one complete workflow
before adding more venues or autonomous capital:

1. **External demo agent runner**
   - Codex/build: maintain a reusable submit-only agent example with valid,
     blocked, and retry-idempotency scenarios.
   - Operator/user: create an agent in the UI, copy its Signal endpoint and
     Signal key, and run the documented scenarios.
   - Current implementation:
     `examples/agent-signal-runner`.
   - Current implementation: `examples/creator-agent-sdk` explains the
     non-hosted model and provides a dependency-free decision helper for
     evidence-rich trade decisions, freshness/idempotency fields, and
     submit-only ClearSig signal delivery.
2. **Repeatable paper-trading demo**
   - Codex/build: keep setup readiness, policy decisions, execution, PnL,
     scorecards, and audit events connected and testable.
   - Operator/user: choose the demo vault and strategy story, then verify the
     complete flow as a trader would see it.
3. **Market-data adapter boundary**
   - Codex/build: add provider-neutral price, candle, funding-rate, and open
     interest interfaces without giving data providers execution authority.
   - Operator/user: choose the first market-data provider and supply its
     backend-only API credentials if required.
   - Current implementation: `/api/agent-market-data/[provider]` exposes a
     rate-limited, read-only provider boundary. The deterministic mock adapter
     supplies BTC, ETH, and SOL perpetual mark price, funding, open interest,
     and 24h volume. The Hyperliquid provider reads live public perpetual mark
     price, funding, open interest, and 24h notional volume without credentials
     or execution authority.
4. **One testnet execution venue**
   - Codex/build: connect one backend adapter and require verified exchange
     order artifacts before recording execution.
   - Operator/user: create and fund the testnet account, then supply
     backend-only venue credentials.
   - Current implementation: ClearSig can submit a policy-approved,
     idempotent intent to an isolated Hyperliquid testnet executor and accepts
     success only when the executor returns a matching verified order artifact.
     `examples/hyperliquid-testnet-executor` repeats hard notional, leverage,
     freshness, account, market-order, and slippage checks before using the
     pinned official Hyperliquid Python SDK. The API-wallet private key stays
     in the executor process and never enters the browser, agent state, or
     ClearSig signal API.
5. **Human-approved capital allocation**
   - Codex/build: turn leaderboard performance into bounded allocation
     recommendations, promotions, demotions, and fresh policy-bound sessions.
   - Operator/user: approve allocation tiers, promotion thresholds, and the
     maximum capital any agent may receive.
   - Current implementation: scorecards and trust scores deterministically
     recommend Probation, Trusted, or Proven authority. Recommendations use
     executed trades, realized PnL, drawdown, rule-violation rate, and human
     overrides. Every recommended limit is clamped to the vault policy and
     opens a prefilled session review; no recommendation automatically grants
     authority or transfers funds.
6. **Published external-agent registry**
   - Codex/build: add public creator profile fields, supported markets,
     signing-key metadata, evidence requirements, user-facing disclosures, and
     registry status for outside agents.
   - Operator/user: publish an externally hosted agent, verify its signing
     identity, submit decisions through the SDK, and confirm the marketplace
     only shows ClearSig-observed performance.
7. **Real-capital authority hardening**
   - Codex/build: add wallet-signed backend mutations, on-chain grants and
     revocation, signed agent intents, confidential enforcement, and durable
     venue reconciliation.
   - Operator/user: approve deployment authorities, fund the controlled vault,
     and complete security review before enabling real capital.

### Operator Demo Checkpoint

Use the runner to prove these states in order:

1. With no active session, import a `valid` signal and confirm it needs human
   approval.
2. Start a bounded paper session, submit a new `valid` signal, and confirm it
   is allowed.
3. Submit `blocked` and confirm hard risk limits reject it.
4. Submit `retry` and confirm the second webhook is ignored as a duplicate.
5. Trigger the kill switch and confirm otherwise-valid agent trading stops.
6. Close a paper position and confirm PnL, scorecard, leaderboard, and audit
   history update.

### Operator Hyperliquid Testnet Checkpoint

This checkpoint requires the operator because it creates external credentials
and introduces testnet trading authority:

1. Create a dedicated Hyperliquid testnet API wallet. Do not use a primary
   wallet private key.
2. Fund the main Hyperliquid testnet account with test collateral.
3. Follow `examples/hyperliquid-testnet-executor/README.md` to install the
   pinned official SDK and start the isolated executor on `127.0.0.1:4010`.
4. Set `CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS`,
   `CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL`, and
   `CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN` only in the ClearSig server
   environment.
5. Restart ClearSig on port `3000`. Confirm Live venue setup reports both the
   executor configuration and public testnet account funding state.
6. Approve one small Hyperliquid testnet signal and use Send to venue. Confirm
   ClearSig records the returned order ID once and treats retries as
   duplicates.

### Guided Start-Trading Journey

The app now carries a new user beyond trader setup and through the first
confirmed practice trade:

1. Choose a prepared agent from the ClearSig Agent Library, create one, or
   use the advanced outside-trader connection path.
2. Confirm the trader is active and its trading plan is complete.
3. Confirm the chosen practice account is allowed by the safety rules.
4. Confirm the trader has a current allowance for that practice account.
5. For Hyperliquid practice, confirm the account is connected, funded, and the
   protected trading connection is reachable.
6. Turn on automatic trading so ClearSig can act within that allowance even
   while the page is closed.
7. Connect the trader and wait for its first idea.
8. Confirm that the first practice trade was actually placed.

The journey keeps the money-holding account separate from the trader. Traders
only send ideas. The protected ClearSig connection places a trade after the
idea passes the current rules and allowance. The Start Trading screen reads the
saved ClearSig record, so it can confirm a trade that was placed while the user
was away.

For an outside practice account, funds, positions, and profit remain in that
outside account. The ClearSig wallet currently groups the trader, rules,
allowance, and history; it does not custody or automatically receive venue
profit. Hyperliquid position and PnL reconciliation is still required before
the outside account can become ClearSig's durable source of truth.

New practice accounts can add their own account, funding, and protected
connection checks without changing the trader setup flow.

### ClearSig Agent Library

The Agent Library should feel closer to Hyperliquid Vaults' decision flow than
a plain bot picker: users compare performance, risk, and recommended authority
before assigning funds. ClearSig's difference is that the final allowance is
bounded by user-owned safety rules, not by a black-box manager.

Product model to mirror:

| Product pattern | What to learn | ClearSig version |
| --- | --- | --- |
| Hyperliquid Vaults | Rank by visible results before allocation | Agent cards show score, PnL, trades, safety stops, drawdown, recent PnL, and allowance |
| Enzyme delegation | Hard rules should limit delegated action | Safety rules and allowance are checked before every trade idea |
| Composer | Make strategy and setup understandable | Prepared agents start with editable plans and plain-language next steps |
| Giza / ARMA | Activation should feel like an agent is working | Start Trading moves from readiness checks to the first practice trade |
| Almanak | Advanced users need deeper simulations and agent tooling | Future pro path can add backtests, stress tests, and external agent frameworks |

The normal first-run path now hides outside-agent connection details:

- the library offers Steady BTC, Balanced Markets, and Treasury Guard,
- each prepared trader arrives with a complete, editable practice plan,
- choosing one goes directly to reviewing its suggested small allowance,
- a ready built-in trader can prepare its first practice idea from the Start
  Trading journey,
- the idea still passes through the normal ClearSig safety evaluator before a
  practice trade opens,
- prepared traders begin with no claimed track record,
- creating a custom trader remains simple, while connecting an outside trader
  is clearly marked as an advanced path.

Current Agent Library decision signals:

- trust score,
- total profit/loss,
- recent profit/loss,
- closed trades,
- current open trades,
- win rate,
- safety stops,
- drawdown,
- human overrides,
- agent age,
- recommended allowance tier,
- "why this allowance?" reasons,
- next level requirements.

Current user-testing additions:

- the Start Trading page now doubles as a live control room with open practice
  trades, close controls, pause-this-agent, pause-all-trading, current
  allowance, recent actions, and market data used for the next decision,
- prepared ClearSig agents can use the read-only market-data route when
  preparing their first practice idea. Hyperliquid public data is preferred
  when available, with practice data as the local fallback,
- the Agent Library has a clearly labelled demo-history action that seeds
  prepared demo agents, closed practice trades, and stopped ideas for product
  testing. Demo history is for testing the experience; it is not presented as
  community or real user performance.

Journey rule: if a current allowance already exists, the Library must move the
user forward to Start Trading. It should only send the user back to Give
Allowance when no current allowance exists or the current allowance needs
review.

Next library additions:

1. Add last 7 / 30 day filters and market-focus filters.
2. Add a full agent profile drawer with trade history and rule-stop history.
3. Add simulated/backtested history for prepared agents, clearly labelled as
   demo history and never mixed with real wallet results.
4. Add community agents once identity, signing, and publishing rules are ready.
5. Add venue reconciliation so outside-account PnL becomes part of the agent
   record without manual close entries.

### Operator Allocation Checkpoint

The default demo tiers are intentionally conservative:

| Tier | Qualification | Recommended authority |
| --- | --- | --- |
| Probation | New or currently unqualified agent | `$250`, `1x`, one position, four hours |
| Trusted | 20+ executions, score 70+, positive PnL, drawdown <=10%, violation rate <=10%, at most one override | `$500`, `2x`, two positions, 12 hours |
| Proven | 50+ executions, score 82+, positive PnL, drawdown <=6%, violation rate <=5%, zero overrides | `$1,000`, `2x`, three positions, 24 hours |

The operator should review these values before a trader demo and decide:

1. The maximum per-trade notional the demo vault may authorize.
2. Whether the demo should show only Probation and Trusted, or also Proven.
3. Whether promotion requires positive realized PnL or only risk compliance.
4. Which human actions count as overrides in the production scorecard.

The vault policy always wins when it is stricter than a tier.

## MVP Readiness Review

The current flow is close to a usable paper-trading MVP:

- registration moves directly into Strategy Playbook setup,
- readiness points users to the next missing setup item,
- risk limits, bounded sessions, signal inbox, approvals, paper execution,
  positions, PnL, scorecards, and audit events are connected,
- unsafe or stale authority falls back to human approval instead of bounded
  execution,
- local-first actions expose backend-sync status instead of pretending durable
  persistence succeeded.

The domain and API layout are modular enough to continue without rewriting the
current wallet product. Policy evaluation, intake, persistence, execution
adapters, inbox storage, and readiness remain separate modules.

This is not ready for real capital yet. The remaining hard blockers are:

- agent-state mutations still need Solana wallet/member authorization instead
  of relying on same-origin browser requests,
- session grants and revocation state need an on-chain authority account,
- live/testnet adapters must return verified exchange order artifacts before an
  execution is marked placed,
- Encrypt pre-alpha is wired but is not yet real confidentiality,
- exchange positions and PnL must become the durable source of truth for live
  venues.

## Local Testing Rule

Implementation stays local until the user tests it.

Workflow:

1. Implement a small module.
2. Run typecheck, lint, tests, and build when UI changes.
3. Give a local test checklist.
4. Wait for user confirmation before pushing.
