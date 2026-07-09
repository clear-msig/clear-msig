# Policy And Protection Runbook

Policies are the second security center of ClearSig. This document separates
what is truly enforced today from what is still a client-side guardrail.

## Current Enforcement Boundary

On-chain today:

- Wallet approval threshold.
- Cancellation threshold.
- Intent timelock before execute.
- Proposer and approver membership checks.
- Proposal status checks before execute.
- Typed ClearSign proposal commitments for typed surfaces.
- Typed SOL send policy bytes are committed in the ClearSign envelope and stored
  on the typed proposal. When present, the program enforces recipient
  allow/block lists, per-send SOL amount caps, required extra approvers, and
  extra cooldown seconds before moving lamports.
- Typed SOL velocity caps are tracked by a program-owned `PolicySpendState`
  PDA per wallet. The state is bound to the active policy commitment, resets
  when the policy commitment changes, and rejects sends that would exceed the
  committed lamport cap inside the configured time window.
- Intent policy ciphertext references are stored with intents for future FHE
  evaluation.

Client-side today:

- Velocity and time-window rules outside typed SOL send.
- Non-SOL recipient allow/block rules.
- Non-SOL amount limits.
- Non-SOL extra approver policy rules.
- Non-SOL additional cooldown rules beyond the on-chain intent timelock.

The client-side rules protect the normal app path, but they are not a final
security boundary. A signer who bypasses the frontend and submits through the
CLI/backend can still avoid richer policy checks on surfaces that do not yet
have typed policy executors/FHE policy handlers.

## App-Level Guardrails

Every money-moving send page must enforce policy denies in the mutation path,
not only through disabled buttons or banners. The required guard is:

```ts
const plan = await resolvePolicyEnforcement(walletName, candidate);
assertPolicyNotDenied(plan);
```

Run this coverage check after touching send pages:

```bash
npm test -- --run src/lib/policies/__tests__/enforce.test.ts src/lib/policies/__tests__/sendCoverage.test.ts
```

## What Must Become On-Chain

Before we claim policies are fully verifiable and on-chain-enforced, the program
still needs typed policy execution for:

- Deny rules.
- Recipient allow/block rules outside typed SOL send.
- Per-action amount caps outside typed SOL send.
- Daily/weekly/monthly velocity caps outside typed SOL send.
- Extra approver requirements outside typed SOL send.
- Extra cooldown requirements outside typed SOL send.
- Agent trading risk limits and session allowances.

The final form should be:

1. Policy values are committed/encrypted.
2. ClearSign text includes the active policy commitment.
3. The program checks the typed action against policy state before execute.
4. Failed policy checks return explicit program errors.
5. Frontend, backend, and tests never treat local policy evaluation as the
   source of truth.

## Test Priorities

High priority checks:

- Deny policy cannot open a wallet signer from the normal app flow.
- Deny policy cannot create a proposal from the normal app mutation.
- Extra approver policy cannot execute until the required signer approves.
- Cooldown policy delays execution before broadcast.
- Threshold and timelock still fail on-chain if the frontend is bypassed.
- Typed proposal policy commitment mismatch fails on-chain.
- Typed SOL send recipient blocklist and amount cap failures return explicit
  program policy errors.
- Typed SOL velocity attempts that exceed the committed time-window cap return
  an explicit program policy error before lamports move.

Program checks to keep running:

```bash
cargo test -p clear-wallet timelock
cargo test -p clear-wallet threshold
cargo test -p clear-wallet typed
```

Frontend checks to keep running:

```bash
npm test -- --run src/lib/policies/__tests__/enforce.test.ts src/lib/policies/__tests__/sendCoverage.test.ts
npm run typecheck
```
