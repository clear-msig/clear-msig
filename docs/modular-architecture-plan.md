# ClearSig Modular Architecture Plan

Status: started on devnet.

ClearSig should be built as small product and protocol modules, not one large
server or one oversized program surface. The goal is simple: when BTC send,
Pro escrow, Agent trading, Secure recovery, or Swap has a bug, the targeted
module can be fixed and tested without destabilizing the rest of the app.

## Backend Shape

The backend should keep `main.rs` focused on process startup, shared state,
CORS, tracing, and route mounting. Product areas should live in modules or
crates:

- `pro`: schedules, escrow, audit, payments, B2B workflows.
- `wallet`: wallet create/show, chain setup, memberships.
- `intents`: add/update/remove intent preparation and submission.
- `proposals`: create, approve, cancel, execute, stream, cleanup.
- `clearsign`: typed action envelopes, policy commitments, replay protection.
- `secure`: recovery vault preparation and wallet-specific signing paths.
- `swap`: quotes, solver config, route validation, execution receipts.
- `risk`: simulation, policy checks, address screening, risk labels.

This pass starts that direction by moving Pro persistence and Pro routes out of
`backend-api/src/main.rs` into `backend-api/src/pro.rs`.

## Program Shape

ClearSign Policy Engine v2 should be modular from day one:

- typed action schema module
- policy commitment module
- nonce/replay module
- approval/member module
- escrow policy module
- agent policy module
- recovery policy module
- future swap policy module

Each module should expose a small verifier that receives canonical action data
and returns either approved execution context or a clear rejection.

## Encrypt Readiness

Encrypt integration should hide behind an adapter boundary:

- devnet/pre-alpha adapter for plaintext or simulated encrypted fields
- future mainnet adapter for real Encrypt execution
- common ClearSig interface for policy field commitments

The goal is that mainnet migration mostly changes environment/config and the
adapter implementation, not product flows or action schemas.

## Rule

Browser explains. Backend prepares. Solana verifies. Signer understands. Chain
enforces. Each layer should have a small module boundary and tests.
