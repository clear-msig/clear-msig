# ClearSign Surface Coverage

ClearSign is only considered complete for a user action when the readable text,
the signed bytes, the on-chain typed proposal, and the executor inputs all bind
to the same payload.

The executable source of truth is
`apps/web/src/lib/clearsign/surfaceCoverage.ts`.

New typed proposals use canonical ClearSign v4 bytes and a program-derived
financial-approval document. Existing v2/v3 proposals retain
approval/cancellation compatibility only.

## Typed on-chain today

- SOL send
- SOL batch send
- SOL escrow release / return
- Typed proposal approve / cancel
- BTC / ETH / Hyperliquid / Zcash / ERC-20 direct send (typed chain-send + Ika)
- Wallet policy persistence (`set_protection` → WalletPolicy PDA)
- Members, threshold, and timelock (`execute_typed_intent_governance`)
- Agent session grant / revoke, bounded trade-approval finalization, and risk policy

## Owner-attested typed on-chain

- Connected Hyperliquid testnet settlement now closes through the isolated
  executor, stores a normalized fill artifact in Redis, derives sequence and
  exposure from the program-owned risk ledger, and creates or resumes the typed
  threshold proposal. The program enforces accounting, sequence, and replay
  protection, but does not verify a native Hyperliquid signature.

## Program-only, not product-wired

- SPL-token escrow release / return
- BTC / EVM / Ika escrow release / return
- Encrypted/private escrow release / return

These instructions and CLI paths exist, but the current product UI does not
execute them end to end. They must not be described as shipped UI coverage.

## Typed approval only / local

- Agent strategy authoring remains browser/server state. Venue order placement
  and closing use a protected testnet executor, not a decentralized venue adapter.
  Session authority itself is on-chain: the executor checks the active session,
  agent, policy commitment, venue, optional market, expiry, leverage, and
  remaining notional before consuming its allowance.

## Still blocked on external networks

- FHE-encrypted policy arithmetic (Encrypt mainnet + program `#[encrypt_fn]`)
- Production distributed MPC for dWallets (Ika mainnet)

Do not market live agent automatic trading, trustless venue settlement, or
encrypted policies as production-safe until native venue attestation,
confidential evaluation, and production MPC are complete.
