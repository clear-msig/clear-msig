# ClearSign Surface Coverage

ClearSign is only considered complete for a user action when the readable text,
the signed bytes, the on-chain typed proposal, and the executor inputs all bind
to the same payload.

## Typed on-chain today

- SOL send
- SOL batch send
- SOL escrow release / return
- SPL-token escrow release / return
- BTC / EVM / Ika escrow release / return
- Encrypted/private escrow release / return
- Typed proposal approve / cancel

## Legacy path, not yet SOL-level typed

- BTC direct send
- ETH direct send
- ERC-20 direct send
- Hyperliquid direct send
- Zcash direct send
- Member, threshold, timelock, setup-rule changes
- Agent settings / strategy / sessions

These legacy paths may still show human-readable signing text, but they are not
yet the ClearSign v2 typed envelope plus typed executor standard. Do not market
them as SOL-level ClearSign until their typed action kind, payload hash, program
executor, backend route, frontend flow, and live E2E all exist.

The executable source of truth is
`frontend/src/lib/clearsign-v2/surfaceCoverage.ts`.
