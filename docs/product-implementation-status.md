# Product implementation status

Verified against repository paths on 2026-07-18. "On-chain" means the named
rule is checked by the Clear Wallet or Ikavery program. It does not imply a
mainnet deployment, audited code, distributed signing, or a trustless external
adapter.

| Product / feature | Current authority | Honest status |
| --- | --- | --- |
| Personal/Pro wallet creation, members, thresholds, timelock | Clear Wallet program | Typed and program-enforced. |
| SOL send and batch send | Clear Wallet program | Recipient, amount, approvals, policy, and execution are typed on-chain. |
| Spend caps, recipient allowlists, allowed hours, member allowances | WalletPolicy, AssetPolicy, and spend-ledger PDAs | Program-enforced for supported typed send executors. CSP1 covers chain-scoped sends; CSP2 currently covers Solana devnet USDC schedules. Browser editors are not the authority. |
| BTC, ZEC, ETH, ERC-20, HYPE sends | Clear Wallet typed chain-send plus Ika/destination adapter | Approval bytes are program-verified; production distributed MPC and audited destination delivery are not complete. Testnet/pre-alpha only. |
| Contacts, watched wallets, UI preferences | Browser storage | Convenience state only; not on-chain and not a security control. |
| Pro SOL escrow release/return | Clear Wallet program | Product-wired typed execution. Escrow project descriptions remain application state. |
| SPL escrow release/return | Clear Wallet program | Product-wired typed execution. Mint, source/destination token accounts, owners, amounts, and escrow identifiers are bound before SPL tokens move. |
| Cross-chain escrow release/return | Clear Wallet program plus Ika binding and settlement artifact | Product-wired typed accounting. It verifies the current IkaConfig/dWallet, route, intent template, and artifact commitment on Solana; it does not itself prove or move destination-chain value. |
| Private escrow release/return | Clear Wallet program plus encrypted-policy and evaluation artifacts | Product-wired ciphertext-bound accounting. It binds the onchain ciphertext references, private evaluation, and settlement artifact; the program does not decrypt or independently prove the evaluation. |
| Pro recurring/scheduled SOL and devnet USDC payments | RecurringSchedule/RecurringTokenSchedule, AssetPolicy, and AssetPolicySpend PDAs | Product-wired onchain schedule state. Configuration/revocation require typed threshold governance; one due payment can be executed permissionlessly at a time. New USDC schedules bind Circle's devnet mint, exact token accounts, six-decimal CSP2 amount cap, recipient policy, velocity, send count, and allowed hours. The CSP2 spend ledger is shared by wallet and mint so separate schedules cannot bypass it. Legacy CSP1 schedules remain executable through their original path. An external caller is still required for each due execution. |
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
