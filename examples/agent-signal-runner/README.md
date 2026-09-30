# ClearSig Agent Signal Runner

This dependency-free runner acts like an external trading agent. It can submit
fresh signed decisions to a ClearSig agent inbox, prove webhook retry
idempotency, and produce a deliberately unsafe signal for a risk-policy demo.

It receives only the submit-only signal key and uses it to create an
`hmac_sha256_v2` decision signature. Never give an external agent the ClearSig
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

Target-bound signed delivery is mandatory. Set `CLEARSIG_SIGNAL_TARGET` to
the exact JSON copied from the authenticated connection screen. The old
`--unsigned` compatibility option now fails without sending a request.

Run the runner's tests:

```bash
node --test examples/agent-signal-runner/run.test.mjs
```

## Signed signal v2 migration

Private registration and inbox management now require a current signed Dynamic
session with a verified Solana wallet in the treasury's current approved
governance membership. A connected hardware wallet alone is not a server session.
Copy the nonsecret **Signal signing target (JSON)** from the connection page.
Pass it as `target` to SDK calls, or set `CLEARSIG_SIGNAL_TARGET` to that JSON
for the runner. It binds the canonical wallet PDA, agent ID, program ID, and
server deployment/network namespace. Never construct it from a display name.

Every submitted envelope must use `signatureScheme: "hmac_sha256_v2"`; it signs
`{domain: "clearsig.agent.signal", scheme: "hmac_sha256_v2", target, signal}`
with recursively sorted keys and omitted undefined properties. `signal` is the
exact submitted object, including `clientSignalId` (stable nonce for retries)
and `submittedAt` (Unix milliseconds). Signals older than ten minutes or over
two minutes in the future are rejected. Legacy v1 and unsigned key-only
requests are no longer accepted. Re-register the connection after deployment;
legacy name-indexed keys are not silently adopted. Possession of the submit-only
key was authentication in v1; v2 adds explicit target and payload binding.
