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

## Non-Negotiable Boundaries

- Agents never receive raw wallet custody.
- Agents never bypass ClearSig policy.
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
- agent proposal routes,
- session grant routes,
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
- approved proposals can be mock-executed,
- mock executions are recorded locally,
- open paper trades can be closed with realized PnL,
- each agent has a detail page for profile, recovery controls, sessions,
  signals, paper trades, scorecard, and audit log,
- audit events are recorded locally,
- scorecards update from proposal/action transitions and closed paper trades.

## Phase 5: Backend Persistence

Move local agent state to backend once the shape is stable:

- durable agents,
- durable proposals,
- durable sessions,
- durable scorecards,
- event log.

The backend should still treat execution as policy-gated. It should not trust
an agent-submitted request without re-evaluating the policy server-side.

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

## Local Testing Rule

Implementation stays local until the user tests it.

Workflow:

1. Implement a small module.
2. Run typecheck, lint, tests, and build when UI changes.
3. Give a local test checklist.
4. Wait for user confirmation before pushing.
