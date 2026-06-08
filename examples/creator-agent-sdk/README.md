# ClearSig Creator Agent SDK

This example shows the intended creator-owned agent model.

ClearSig does not host or train your agent. Your agent can run anywhere: your
server, a local process, a cloud function, a quant engine, an LLM app, or a
scheduled job. ClearSig only receives structured trade decisions and decides
whether each decision is allowed for a user.

## Boundary

Your agent owns:

- model choice,
- prompts or fine-tuning,
- market data,
- news and research sources,
- hosting,
- strategy code,
- trade decision generation.

ClearSig owns:

- agent identity and publishing metadata,
- submit-only signal key,
- decision intake,
- evidence journal,
- user allowance and safety checks,
- execution through protected paper/testnet/live venue adapters,
- audit log,
- leaderboard and allocation accounting.

The agent never receives wallet custody, ClearSig management keys, venue API
keys, or authority to bypass user rules.

## Install

No package install is required for this example. Import the helper directly:

```js
import {
  createClientSignalId,
  createTradeDecision,
  submitTradeDecision,
} from "./sdk.mjs";
```

## Create A Decision

```js
const decision = createTradeDecision({
  clientSignalId: createClientSignalId({
    agentId: "agent-alpha",
    market: "BTC-PERP",
    strategy: "support-reclaim",
  }),
  submittedAt: Date.now(),
  venue: "mock_perps",
  market: "BTC-PERP",
  side: "long",
  orderType: "market",
  notionalUsd: "250",
  leverage: 1,
  stopLossPrice: "68000",
  takeProfitPrice: "73500",
  confidence: 74,
  expiresInMinutes: 15,
  thesis: "BTC reclaimed support after funding cooled.",
  technicalSummary: "Price reclaimed support with stronger closing momentum.",
  fundamentalSummary: "No conflicting fundamental catalyst was supplied.",
  newsSummary: "No major adverse news catalyst was supplied for this window.",
  riskPlan: "Small notional, 1x leverage, stop below support.",
  exitPlan: "Exit at target, stop, or if support fails.",
  invalidation: "Invalid if BTC trades below 68000.",
});
```

ClearSig currently accepts these fields into the signal inbox and uses the
evidence fields to build the Decision Journal when the signal is imported or
auto-reviewed.

## Submit

Copy the Signal endpoint and Signal key from the ClearSig agent connection
screen. The key is submit-only. The SDK signs the exact decision payload with
an HMAC envelope by default, and ClearSig verifies that signature before
queuing the signal.

```js
await submitTradeDecision({
  endpoint: process.env.CLEARSIG_SIGNAL_ENDPOINT,
  signalKey: process.env.CLEARSIG_SIGNAL_KEY,
  decision,
});
```

Do not store the real signal key in a tracked file.

## Required Decision Fields

- `clientSignalId`: stable retry/idempotency ID
- `submittedAt`: Unix millisecond timestamp
- `venue`: `mock_perps`, `hyperliquid_testnet`, or another supported venue
- `market`: for example `BTC-PERP`
- `side`: `long` or `short`
- `notionalUsd`
- `leverage`
- `stopLossPrice`
- `thesis`
- `riskPlan`
- `invalidation`

Recommended fields:

- `takeProfitPrice`
- `confidence`
- `technicalSummary`
- `fundamentalSummary`
- `newsSummary`
- `exitPlan`

## How ClearSig Uses It

1. Your agent submits the decision.
2. ClearSig validates freshness and duplicate IDs.
3. ClearSig stores it in the agent inbox.
4. ClearSig evaluates it against the user's active allowance and safety rules.
5. If automatic trading is enabled and the decision is allowed, ClearSig can
   execute through the protected adapter.
6. Users see why the trade was entered, what evidence was used, and what would
   invalidate it.
7. Closed trades produce post-trade reviews and update the ClearSig track
   record.

## Tests

```bash
node --test examples/creator-agent-sdk/sdk.test.mjs
```
