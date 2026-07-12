# ClearSig trust boundaries

This document assumes each component is malicious or unavailable in isolation.
It describes the current pre-alpha system, not the intended production system.

| Component | What compromise can do today | What it must not be able to do | Detection and recovery | Remaining gap |
| --- | --- | --- | --- | --- |
| Frontend | Misdescribe a request, hide state, choose a hostile recipient, or refuse service. | Change bytes after the wallet signature or bypass program policy. | Client reconstructs signable bytes from on-chain state; Ledger can display the canonical text; use another client or CLI. | Same-origin XSS can initiate a new misleading request. Hardware display coverage is incomplete. |
| Backend / relayer | Censor, delay, reorder independent requests, return errors, or withhold broadcast. | Forge a user signature, change committed payload fields, lower thresholds, or execute an unapproved proposal. | Compare proposal/envelope/payload hashes on chain; any authorized participant can run the CLI. Backend execution uses the shared library with a strict schema, bounded worker pool, timeout accounting, response caps, and structured outcome logs. | Solana/Ika calls are synchronous. A timed-out worker cannot yet be forcibly cancelled, although concurrency remains bounded. |
| Execution library / CLI adapter | Refuse execution, fail after a partial step, or submit the wrong transaction attempt. | Make a destination transaction with fields different from the approved preimage. | Adapter arguments are validated into an opaque typed request before entering the worker pool. Program verifies the typed action; destination chain verifies the signature; signed MessageApproval state supports resume. | HTTP routes still build adapter arguments, and the shared library still contains blocking infrastructure adapters; typed route constructors and cancellable async ports remain open. |
| Redis / notification storage | Drop, duplicate, delay, or fabricate notifications. | Create approvals, sessions, policies, or transfers. | Rebuild UI state from Solana and destination chains. | Notifications are convenience data and must never become authorization inputs. |
| Solana RPC | Censor reads/writes, serve stale data, or lie to one client about account state. | Change finalized ledger state or produce a valid user signature. | Retry another RPC, verify account owners/discriminators, compare finalized transaction signatures. | Production clients need multi-provider/quorum reads for high-value decisions. |
| Destination-chain RPC/indexer | Hide balances, misreport UTXOs, reject broadcasts, or return stale fees. | Mutate a signed destination transaction. | Cross-check another provider or broadcast the same raw transaction elsewhere. | Fee and UTXO selection still depend on external indexed data before signing. |
| Ika / dWallet signer | Refuse signing, delay signing, or return an invalid signature. In the current mock model, signer compromise is a critical key-control risk. | In production, sign outside an approved ClearSig/Ika policy session. | Destination verification rejects invalid signatures; pause the wallet and rotate/rebind when supported. | The current single/mock signer is not acceptable for real funds. Production threshold MPC and independent audit are release blockers. |
| Solana program | A bug can incorrectly authorize, reject, or account for execution. | Nothing can compensate for a program authorization bug. | Deterministic tests, reproducible builds, upgrade-authority controls, monitoring, and emergency client pause. | External Solana/Rust audit and a hardened upgrade-governance process are required before mainnet. |

## Execution properties

- **Payload integrity:** typed proposal execution recomputes the action payload
  and envelope commitments. A relayer cannot substitute recipient, amount,
  chain, route, session, or policy bytes without rejection.
- **Replay resistance:** proposal index is part of the signed vote and proposal
  PDA. Finalized proposals reject a second execution. Action IDs, nonces, and
  expiry are hash-bound and length/time validated.
- **Idempotent recovery:** an interrupted Ika flow reuses an already-signed
  MessageApproval instead of requesting another signature. Destination-chain
  rebroadcast uses the same raw signed transaction.
- **Replaceable relayer:** approval and policy state live on Solana. An
  authorized participant can run `clear-msig` directly with the same proposal
  and destination RPC. Backend availability is not an authorization primitive.

## Production blockers

1. Replace the mock Ika signer with production distributed MPC.
2. Split CLI-shaped parsing from the shared core and migrate blocking Solana/Ika
   adapters to cancellable async ports. Child-process orchestration is retired.
3. Add multi-provider RPC verification for high-value reads and broadcasts.
4. Complete adversarial/property testing and commission an external audit.
5. Put program upgrades behind reviewed, multi-party operational governance.
