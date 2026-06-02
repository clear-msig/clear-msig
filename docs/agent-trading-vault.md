# ClearSig Agent Trading Vault

ClearSig is not just a multisig. The stronger product direction is:

> a policy-governed capital-control layer for agent-managed trading groups.

The group deposits funds into a shared vault. Agents can research, propose,
and eventually execute trades, but they never receive unconditional custody.
Access is bounded, observable, revocable, and time-limited.

This is the right framing for agent trading systems, including Hermes-style
agents that persist across sessions, keep context, delegate subtasks, and run
inside sandboxes. The agent layer should produce structured trade intents.
ClearSig should decide whether those intents are allowed to touch capital.

## Why This Fits ClearSig

The repo already has the primitives that matter:

- shared wallets and member management,
- proposer / approver flows,
- readable intent templates,
- policy and rules surfaces,
- proposal approval and execution,
- activity and audit trails,
- multi-chain execution paths,
- backend-mediated command execution.

That means the missing piece is not "a wallet." The missing piece is:

- agent identity,
- agent permissions,
- risk validation,
- session-based authority,
- leaderboard-based allocation,
- venue adapters for trading endpoints.

## Core Product Thesis

The product is not "agents can trade user funds."

The product is:

- agents can earn limited authority over shared capital,
- the authority is constrained by readable rules,
- the group can pause, revoke, or override it,
- every action is logged and attributable,
- bad behavior reduces future access.

That is a capital-control product, not a custody product.

## Product Modes

### 1. Propose Only

The agent submits a structured trade proposal:

- venue,
- market,
- side,
- size,
- leverage,
- entry conditions,
- stop loss,
- take profit,
- expiry,
- rationale.

The human group approves or rejects. This is the safest starting point and
the best first release.

### 2. Bounded Execution

The agent gets a session grant:

- max notional,
- max leverage,
- max position size,
- max daily loss,
- max drawdown,
- allowed markets,
- allowed venues,
- cooldowns,
- expiry.

The agent can execute without per-trade approval only while inside those
limits. Any violation blocks execution or escalates to humans.

### 3. Leaderboard Allocation

Multiple agents compete for access.

The vault can allocate capital to the best performers based on:

- return,
- drawdown,
- consistency,
- rule compliance,
- human override rate,
- execution quality.

This is the most differentiated version of the product:

- top agents earn more capital,
- bad agents lose access,
- allocation is always bounded by policy.

## Recommended MVP Sequence

### MVP 1: Agent Trade Proposals

- Agent identity is separate from human members.
- Agent generates a structured proposal.
- ClearSig validates it against the vault rules.
- Humans approve it.
- Backend executes it on a testnet or mocked venue.

This is the safest first path, but it is not enough by itself. If every trade
waits for a human to be online, the vault will miss entries in fast markets.
The MVP must therefore include a narrow bounded-session mode.

### MVP 2: Session Grants

- Humans issue a time-limited grant to an agent.
- The grant has strict capital and venue limits.
- ClearSig enforces the guardrails before execution.
- Humans can pause or revoke instantly.

### MVP 3: Reputation + Leaderboard

- Track PnL, drawdown, compliance, and rejection rate.
- Rank agents by risk-adjusted performance.
- Grant higher limits to better agents.

### MVP 4: Multi-Agent Committee

- Research agent proposes.
- Risk agent reviews.
- Execution agent routes the trade.
- A trade only lands if the policy engine approves it.

## What Must Exist Before Real Capital

These are the missing pieces that have to be built carefully:

- agent identity model,
- agent permissions distinct from human members,
- signed agent intent format,
- rule engine for trading constraints,
- position and exposure tracking,
- leaderboards,
- kill switch and emergency pause,
- agent sandboxing and key isolation,
- venue adapters for perps venues,
- durable audit trail for agent actions.

## Safe Implementation Order

1. Start with proposal-only flows.
2. Use testnet or a mock execution venue first.
3. Add bounded execution with strict rule checks.
4. Add leaderboard-based access only after the rules are proven.
5. Expand to more venues after the control model is stable.

The wrong way to build this is to give agents raw wallet access.
The right way is to let agents earn constrained, revocable authority.

## Why This Is Strong

Normal multisig asks:

- who can sign?

ClearSig Agent Trading Vault asks:

- who, human or agent, can act with group capital,
- under what conditions,
- for how long,
- with what visibility,
- and with what automatic revocation?

That is a much larger and more defensible product surface.

## Additional Use Cases

This same control layer can support:

- DAO prop trading desks,
- family-office agent portfolios,
- treasury hedge agents,
- creator trading leagues,
- multi-agent investment committees,
- milestone-based grant release,
- payroll and treasury automation,
- bounded copy-trading vaults,
- emergency treasury defense agents.

## Current Positioning

ClearSig v2 can grow into this without discarding the current product.
The current app already has the right primitives; the new surface is a
controlled extension, not a rewrite.

The product should be described as:

> a programmable financial constitution for humans and agents, where capital
> access is earned, bounded, and continuously re-evaluated.
