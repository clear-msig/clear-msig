# ClearSig Agent Signal Runner

This dependency-free runner acts like an external trading agent. It can submit
fresh signed decisions to a ClearSig agent inbox, prove webhook retry
idempotency, and produce a deliberately unsafe signal for a risk-policy demo.

It receives only the submit-only signal key and uses it to create an
`hmac_sha256_v1` decision signature. Never give an external agent the ClearSig
management key, wallet credentials, or venue credentials.

## Setup

1. Run ClearSig at `http://localhost:3000`.
2. Register an API or Autonomous agent.
3. Complete its Strategy Playbook and Risk limits.
4. Open the agent's Connection page.
5. Copy the Signal endpoint and Signal key.

Export the values in the terminal that will run the agent:

```bash
export CLEARSIG_SIGNAL_ENDPOINT="http://localhost:3000/api/agent-signals/<wallet>/<agent>"
export CLEARSIG_SIGNAL_KEY="<submit-only-signal-key>"
```

Do not save the real signal key in a tracked file.

Without Upstash Redis configured, the local inbox uses development memory.
Restarting the server or hot-reloading its inbox module can require reopening
the Connection page so ClearSig registers the local signal key again.

Optionally let the demo agent derive its stop and target from ClearSig's
read-only mock market-data adapter:

```bash
export CLEARSIG_MARKET_DATA_URL="http://localhost:3000/api/agent-market-data/mock"
```

Market-data access is separate from the submit-only signal key and from all
execution credentials.

## Demo Scenarios

First, leave the agent without an active bounded session and submit a valid
signal:

```bash
node examples/agent-signal-runner/run.mjs --scenario valid
```

Refresh the Connection inbox and import it. The signal should require human
approval. Then start a current bounded session and run the command again. The
new valid signal should be allowed when it passes the configured risk limits.

Submit a deliberately unsafe signal:

```bash
node examples/agent-signal-runner/run.mjs --scenario blocked
```

With the default ClearSig policy, it is blocked because it requests `$25,000`
at `20x` leverage and omits a stop loss.

Prove that an agent can safely retry a webhook without creating two signals:

```bash
node examples/agent-signal-runner/run.mjs --scenario retry
```

The runner submits the same `clientSignalId` twice and fails unless ClearSig
marks the second request as a duplicate of the first.

Preview a fresh payload without sending it:

```bash
node examples/agent-signal-runner/run.mjs --scenario valid --dry-run
```

Signed decision delivery is the default. To test the old signal-key-only
compatibility path explicitly:

```bash
node examples/agent-signal-runner/run.mjs --scenario valid --unsigned
```

Run the runner's tests:

```bash
node --test examples/agent-signal-runner/run.test.mjs
```
