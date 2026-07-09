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
- Intent policy ciphertext references are stored with intents for future FHE
  evaluation.

Client-side today:

- Recipient allow/block rules.
- Amount limits.
- Time-window rules.
- Velocity rules based on local transaction history.
- Extra approver policy rules.
- Additional cooldown rules beyond the on-chain intent timelock.

The client-side rules protect the normal app path, but they are not a final
security boundary. A signer who bypasses the frontend and submits through the
CLI/backend can still avoid these richer policy checks until the program has
typed policy executors/FHE policy handlers.

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
needs typed policy execution for:

- Deny rules.
- Recipient allow/block rules.
- Per-action amount caps.
- Daily/weekly/monthly velocity caps.
- Extra approver requirements.
- Extra cooldown requirements.
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
