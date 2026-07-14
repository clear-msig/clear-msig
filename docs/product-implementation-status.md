# Product implementation status

Verified against repository paths on 2026-07-13. "On-chain" means the named
rule is checked by the Clear Wallet or Ikavery program. It does not imply a
mainnet deployment, audited code, distributed signing, or a trustless external
adapter.

| Product / feature | Current authority | Honest status |
| --- | --- | --- |
| Personal/Pro wallet creation, members, thresholds, timelock | Clear Wallet program | Typed and program-enforced. |
| SOL send and batch send | Clear Wallet program | Recipient, amount, approvals, policy, and execution are typed on-chain. |
| Spend caps, recipient allowlists, allowed hours, member allowances | WalletPolicy and allowance ledger PDAs | Program-enforced for supported typed send executors. Browser editors are not the authority. |
| BTC, ZEC, ETH, ERC-20, HYPE sends | Clear Wallet typed chain-send plus Ika/destination adapter | Approval bytes are program-verified; production distributed MPC and audited destination delivery are not complete. Testnet/pre-alpha only. |
| Contacts, watched wallets, UI preferences | Browser storage | Convenience state only; not on-chain and not a security control. |
| Pro SOL escrow release/return | Clear Wallet program | Product-wired typed execution. Escrow project descriptions remain application state. |
| SPL, cross-chain, private escrow executors | Program and CLI | Program-only. No verified end-to-end product UI. |
| Pro recurring/scheduled payments | Browser/backend scheduling | Not autonomously enforced or executed on-chain. A schedule is not a chain guarantee. |
| Agent session, notional/leverage grant, risk cap | Clear Wallet program | Program-owned PDAs and typed threshold governance. |
| Agent connected trade approval | Clear Wallet program | Reserves session allowance and open exposure on-chain; venue submission still uses an operator-controlled testnet API wallet. |
| Agent connected settlement | Hyperliquid testnet executor, Redis artifact, Clear Wallet program | Product-wired owner-attested settlement. Venue fill creates a trusted-server artifact; chain sequence/exposure are read from the risk ledger; threshold approval updates accounting and replay receipt. Hyperliquid signatures are not verified by the program. |
| Agent profiles, strategies, marketplace, scoring | Browser and Redis/backend | Application state, not on-chain truth. |
| Agent automatic trading | Next/Railway process and Redis | Centralized pre-alpha automation; not permissionless, durable autonomous execution. |
| Built-in and bulk mock venues | Browser/backend paper records | Simulation only. No funds or venue settlement. |
| Agent Vault funding | Governed wallet transfer | Allocation can be a real governed transfer, but production autonomous custody/use is blocked on distributed MPC and audited adapters. |
| Secure recovery | Separate Ikavery program plus device/passkey flows | Devnet/pre-alpha implementation. It is not the Clear Wallet policy program and has not completed an external audit. |
| Buy/sell | Rust settlement sidecar | Pre-alpha operator service; not a Clear Wallet on-chain settlement guarantee. |
| Swap | Next/operator solver and testnet adapters | Pre-alpha and operator-dependent; private/FHE settlement is not complete. |
| Encrypt policy inputs | Encrypt pre-alpha client with fallback behavior | Integration shape only; not production confidentiality or on-chain encrypted arithmetic. |
| P2P DeFi | Product placeholder | Not implemented. |
| Notifications, audit feed, transaction-attempt history | Browser/backend/Redis | Operational records, not canonical chain receipts unless a transaction/proposal address is attached and independently verified. |

## Trust qualifications

- The frontend can prepare requests but cannot make a browser-only rule a
  security boundary. Program-owned accounts and destination-chain validation
  are authoritative.
- Railway and Redis are still trusted for Agent venue artifacts, automation,
  notifications, and application state. Settlement hashes stop post-approval
  substitution; they do not prove the server originally reported truthful data.
- Ika integration remains experimental. Production distributed MPC, native
  venue/oracle attestation, permissionless execution, property/fuzz coverage,
  and an external Solana/Rust audit remain release blockers for real capital.

## Send verification levels

- `npm run test:send-matrix` verifies exact readable approval bytes for Google
  WaaS, Phantom, Solflare, and legacy Turnkey across SOL, BTC, ZEC, ETH, and
  Sepolia USDC. It also fails when one of those routes loses typed proposal
  preparation or its expected typed executor.
- That deterministic matrix proves signer-adapter and route contracts; it does
  not claim that a real browser wallet popup opened or that destination-chain
  delivery occurred. Interactive wallet confirmation cannot run unattended in
  CI.
- Live BTC/ZEC two-signer delivery remains a separate funded-fixture smoke via
  `scripts/smoke-btc-zec-two-signer.sh`. A passing unit suite must never be
  reported as a fresh testnet broadcast.
- Sepolia USDT is intentionally absent because no issuer-published deployment
  is configured. The app must not invent a token address to make the matrix
  appear complete.
