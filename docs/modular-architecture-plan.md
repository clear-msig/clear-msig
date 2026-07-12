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

This work has started:

- `backend-api/src/pro.rs`: Pro schedules, escrow, audit, B2B persistence.
- `backend-api/src/wallet.rs`: health, wallet creation, chain setup,
  membership discovery used by Personal, Pro, Agent, Secure, Swap, Ramp, and
  future product surfaces.
- `backend-api/src/intents.rs`: intent list, prepare, add, remove, update.
- `backend-api/src/proposals.rs`: proposal create/list/show, approve, cancel,
  execute, cleanup.
- `backend-api/src/clearsign.rs`: pre-signed request validation and expiry
  formatting, the first slice of the future ClearSign core.
- `crates/clear-msig-command-contract`: backend-independent command and signer
  contracts with bounded validation.
- `crates/clear-msig-execution`: reusable execution library shared by the
  backend worker and thin CLI binary. It owns concrete handlers, cancellation,
  and destination infrastructure without making the backend depend on a CLI.
- `crates/clear-msig-execution/src/chains/transport.rs`: mockable,
  cancellation-aware destination HTTP port shared by BTC, EVM, and Zcash.
- `crates/clear-msig-execution/src/rpc.rs` and `ika.rs`: cancellation-aware
  Solana and Ika infrastructure adapters.
- `cli`: thin binary package that only launches `clear-msig-execution`.

`backend-api/src/main.rs` should remain small: shared state, execution runner,
generic validation, CORS/tracing, and route mounting.

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
