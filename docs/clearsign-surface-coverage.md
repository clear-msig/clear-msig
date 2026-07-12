# ClearSign Surface Coverage

ClearSign is only considered complete for a user action when the readable text,
the signed bytes, the on-chain typed proposal, and the executor inputs all bind
to the same payload.

The executable source of truth is
`frontend/src/lib/clearsign-v2/surfaceCoverage.ts`.

## Typed on-chain today

- SOL send
- SOL batch send
- SOL escrow release / return
- SPL-token escrow release / return
- BTC / EVM / Ika escrow release / return
- Encrypted/private escrow release / return
- Typed proposal approve / cancel
- BTC / ETH / Hyperliquid / Zcash / ERC-20 direct send (typed chain-send + Ika)
- Wallet policy persistence (`set_protection` → WalletPolicy PDA)
- Members, threshold, and timelock (`execute_typed_intent_governance`)
- Agent session grant / revoke and bounded trade-approval finalization

## Typed approval only / local

- Agent strategy authoring and venue order placement remain off-chain / practice.
  Session authority itself is on-chain: the executor checks the active session,
  agent, policy commitment, venue, optional market, expiry, leverage, and
  remaining notional before consuming its allowance.

## Still blocked on external networks

- FHE-encrypted policy arithmetic (Encrypt mainnet + program `#[encrypt_fn]`)
- Production distributed MPC for dWallets (Ika mainnet)

Do not market live agent automatic trading or encrypted policies as SOL-level
ClearSign until venue settlement/reconciliation and confidential policy
evaluation match the typed standard end-to-end.
