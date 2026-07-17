# Trust boundaries

Status: current pre-alpha behavior. This document intentionally separates
authorization guarantees from availability and presentation guarantees.

## Components

| Component | Trusted for | Not trusted for | Enforced response |
| --- | --- | --- | --- |
| Browser/frontend | Collecting intent, rendering, requesting signatures | Authorization, truthful RPC state, final payload construction | Backend/program recompute commitments; signer reviews exact message |
| Backend API | Canonical preparation and orchestration | Forging member signatures or bypassing onchain policy | Program signature, threshold, expiry, payload, policy, and replay checks |
| Redis | Delivery leases, receipts, convenience state | Authorization or ledger truth | Reconcile from Solana/destination chains; fail closed on uncertain rebroadcast |
| Solana RPC | Transporting reads and writes | Final truth under stale or malicious responses | Verify owners/layouts; production still needs provider diversity |
| Solana program | Wallet authority, thresholds, policy, replay, execution state | Availability or destination-chain finality | Deterministic state transitions and typed executor checks |
| Ika | Producing destination signatures | Production distributed trust in the current pre-alpha deployment | Invalid signatures fail destination verification; production MPC is a blocker |
| Destination RPC | Fee/nonce/UTXO data and broadcast | Authorization or immutable transaction mutation | Sign exact preimage; reconcile deterministic transaction identity |
| `rust-settlement` | Nothing until separately authenticated and reviewed | User identity, deposit confirmation, unrestricted payouts | Must remain undeployed/isolated from real funds until fixed |

## Current ClearSign flow

1. The browser collects a typed request and sends it to backend v4 preparation.
2. The backend reads wallet, intent, proposal, policy, threshold, actor, and
   remote transaction-template context from Solana.
3. `clear-msig-signing` normalizes fixed-order canonical bytes, derives the
   payload, renders the document, and derives the v4 envelope.
4. The browser validates the bounded response shape and asks the member to sign
   the exact prepared document plus proposal-specific approval wrapper. It does
   not generate an authority commitment.
5. The backend lifecycle recomputes the canonical fields, rendered document,
   document hash, and envelope before invoking the execution library.
6. The program parses the same canonical bytes, renders the same document,
   verifies the signature, and stores exact canonical, payload, policy, replay,
   and envelope commitments.
7. A typed executor recomputes the payload commitment from actual execution
   arguments and rejects substitution.

## Semantic binding status

New v4 proposals close the former prose/payload gap: canonical bytes are the
shared source for rendering and payload commitment, and the program rejects any
document or executor arguments not derived from those bytes. Existing v2/v3
proposal accounts retain approve/cancel compatibility, but new v2/v3 creation is
disabled.

The remaining semantic limitation is action coverage. Swap, staking, arbitrary
contract interaction, and governance vote do not yet have authoritative
action-specific executors. They are registry-marked review-only, render an
unknown-risk warning, and cannot become v4 approval envelopes.

## Replay and expiry

- Typed proposal PDA and proposal index prevent reuse across proposal records.
- Vote kind, signer, wallet, proposal index, threshold result, expiry, and full
  envelope hash are signed.
- Action ID and nonce are hash-bound and stored onchain.
- Typed proposal creation and votes reject expired records; execution rechecks
  expiry and timelock.
- Destination delivery uses deterministic identities and durable Redis leases in
  production, but destination RPC uncertainty can still delay finality.

## Failure behavior

- Unknown ClearSign versions, networks, action kinds, profiles, hashes, or
  malformed fields fail closed.
- Undecoded actions must never receive an `allowed` or `low risk` label.
- Backend unavailability must not become an authorization dependency; the CLI
  remains a replaceable relayer after canonical intent artifacts are portable.
- Ika pre-alpha or destination RPC failure must leave execution pending/unknown,
  never fabricate confirmation or permit changed-byte retries.
