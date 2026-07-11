# ClearSig Swap Solver Runbook

This is the operator checklist for the Private Swap MVP. Keep it on testnet/pre-alpha until the Ika submitter, solver fills, policy enforcement, and receipts are fully verified.

## Data To Provide

Add these to `frontend/.env.local` for local testing and to Vercel/Render env when deploying:

```bash
CLEARSIG_SWAP_IKA_ENABLED=0
NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID=87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY
NEXT_PUBLIC_IKA_GRPC_URL=https://pre-alpha-dev-1.ika.ika-network.net:443
NEXT_PUBLIC_SOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH

CLEARSIG_SWAP_SOLVER_ID=clearsig-testnet-solver
CLEARSIG_SWAP_SOLVER_URL=https://your-solver.example.com

CLEARSIG_SWAP_SOL_VAULT=<SOLANA_DEVNET_SOLVER_ADDRESS>
CLEARSIG_SWAP_SOL_AVAILABLE=25

CLEARSIG_SWAP_BTC_VAULT=<BITCOIN_TESTNET_SOLVER_ADDRESS>
CLEARSIG_SWAP_BTC_AVAILABLE=0.05

CLEARSIG_SWAP_ETH_VAULT=<SEPOLIA_SOLVER_ADDRESS>
CLEARSIG_SWAP_ETH_AVAILABLE=5

CLEARSIG_SWAP_COLLATERAL_VAULT=<SOLANA_DEVNET_COLLATERAL_ADDRESS>
CLEARSIG_SWAP_COLLATERAL_USD=50000
```

`CLEARSIG_SWAP_IKA_ENABLED` should stay `0` until the real Ika submitter is connected. Set it to `1` only when the solver worker can reserve liquidity, request Ika signing, broadcast the source transaction, and return explorer hashes.

## Funding The Vaults

Create one operator-controlled vault per network. For pre-alpha, these are testnet addresses. Do not use mainnet funds.

SOL vault:

```bash
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/clearsig-swap-solver.json
solana address -k ~/.config/solana/clearsig-swap-solver.json
solana airdrop 10 <SOLANA_DEVNET_SOLVER_ADDRESS>
solana balance <SOLANA_DEVNET_SOLVER_ADDRESS>
```

BTC vault:

Use a Bitcoin testnet wallet address controlled by the solver. Fund it from a testnet faucet or your test wallet, then verify it at:

```text
https://mempool.space/testnet/address/<BITCOIN_TESTNET_SOLVER_ADDRESS>
```

ETH vault:

Use a Sepolia wallet address controlled by the solver. Fund it from a Sepolia faucet, then verify it on a Sepolia explorer.

Collateral vault:

Use a Solana devnet address for the first collateral record. Fund it or record the equivalent test collateral, then set `CLEARSIG_SWAP_COLLATERAL_USD` to the amount the solver is allowed to stand behind.

## How The MVP Works

1. User chooses `From`, `To`, and `Amount`.
2. Backend quotes the route and checks policy.
3. Solver reserves destination liquidity.
4. Solver checks collateral.
5. Ika handoff stays blocked until `CLEARSIG_SWAP_IKA_ENABLED=1` and the submitter is live.

## What Makes It Real

The next production step is a solver worker that owns no user custody, but can:

- keep inventory balances in sync
- reserve liquidity for a quote
- accept a ClearSig-approved intent
- ask the Solana program/Ika path to sign the source-chain transaction
- broadcast to the source/destination network
- write final transaction hashes back to ClearSig

The Solana program remains the policy authority. The solver provides liquidity. Ika provides native-chain signing. The frontend only displays and requests approval.
