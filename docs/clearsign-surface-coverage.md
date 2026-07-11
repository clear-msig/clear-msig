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

## Typed approval only / local

- Agent trade approval finalizer exists on-chain; venue execution is still
  off-chain / practice
- Agent settings / strategy / sessions remain local policy only

## Still blocked on external networks

- FHE-encrypted policy arithmetic (Encrypt mainnet + program `#[encrypt_fn]`)
- Production distributed MPC for dWallets (Ika mainnet)

Do not market agent automatic trading or encrypted policies as SOL-level
ClearSign until their program executors and product flows match the typed
standard end-to-end.
