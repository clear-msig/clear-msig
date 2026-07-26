# ClearSign Policy Engine

Status: v3 migration implemented; program upgrade and ordered service rollout
required before production activation.

V3 standardizes signer prompts as financial approval documents with `ACTION`,
`DETAILS`, `POLICY`, `RISK`, `PURPOSE`, `APPROVAL`, `EXPIRY`, and `PROOF`
sections. New proposal creation is v3-only after the program upgrade. Existing
v2 proposals keep a narrowly scoped legacy approval/cancellation path.

The v3 `APPROVAL` section names the signing pubkey and shows the exact onchain
threshold plus the approval/cancellation count if that signature is accepted.
The program reconstructs those fields from the wallet intent and proposal
bitmaps before verifying the signature; they are not backend-supplied labels.

Clear signing is the center of ClearSig. Every signer must understand the
exact money movement or authority change before their wallet asks for a
signature. The human text, canonical action data, backend preparation, and
Solana program verification must describe the same action.

## Product Rule

One signing prompt should answer:

- What is happening?
- How much money moves?
- Who receives it?
- Which wallet is authorizing it?
- Which approvals/policy protect it?

Infrastructure words such as RPC, Ika, DKG, UTXO, params, model, and server
refresh must not appear in primary signing copy.

## Architecture

ClearSign follows:

1. Browser explains the typed action.
2. Backend prepares and simulates the action.
3. Solana verifies the canonical action and policy commitment.
4. Signer signs the complete canonical approval document.
5. Chain enforces before money or authority moves.

## Typed Actions

Every action that requires a wallet signature must have a versioned action
type. The current action families are:

- `send`
- `batch_send`
- `add_member`
- `remove_member`
- `change_threshold`
- `set_protection`
- `release_milestone`
- `return_escrow_funds`
- `agent_trade_approval`
- `recovery_action`
- `swap_intent`

Legacy `Custom` intents may remain for backwards compatibility, but new
product surfaces should emit typed actions.

## Canonical Action Envelope

Every new action uses the v3 envelope:

```json
{
  "version": 3,
  "kind": "send",
  "walletName": "Team",
  "walletId": "optional-onchain-pda",
  "actionId": "client-or-backend-generated-id",
  "nonce": "monotonic-or-random-domain-separated-nonce",
  "expiresAt": 1782020807,
  "policyCommitment": "sha256-hex",
  "payload": {}
}
```

The signer-facing text is derived from this envelope and payload. The program
must verify the same canonical payload or a hash commitment to it.

## Clear Signing Text

The primary text should be short and literal.

Send:

```text
Send 2.5 SOL from Team to Sarah
Requires 2 approvals
Expires 2026-07-08 10:00:00
```

Escrow return:

```text
Return remaining escrow funds from Team
Alice receives 4.5 SOL
Bob receives 3 SOL
Requires team approval
Expires 2026-07-08 10:00:00
```

Agent trade:

```text
Approve BTC-PERP long up to $500 at 5x max
Stop loss required
Expires 2026-07-08 10:00:00
```

The signed bytes must include enough canonical identifiers to prevent the same
text from being replayed in another wallet, chain, proposal, or policy.

## Policy Commitments

Every protected action includes a policy commitment. The commitment covers the
policy rules relevant to that action:

- approval threshold
- approvers/members
- spending limits
- escrow funders/milestones
- agent venue/market/leverage/notional limits
- recovery threshold and authorized recovery keys
- swap slippage, route, and asset limits

The UI shows the human policy. The backend and program verify the commitment.

## Replay Protection

Every signature must bind:

- `version`
- `kind`
- `walletId` or wallet PDA
- `walletName`
- `actionId`
- `nonce`
- `expiresAt`
- `policyCommitment`
- canonical payload hash

No signature should be valid for a different wallet, action, proposal, policy,
or expiry.

## Escrow v2

Escrow rules:

- Milestone release can only pay the configured recipient and amount.
- Return-to-sender can only return remaining funds to recorded funders.
- Funder attribution is scoped to funder, funding entity, asset, and chain.
- Milestone recipients can be tagged to a separate delivery entity such as a
  construction company, cooperative, vendor, or project SPV.
- Return math is per asset.
- Pro-rata share is based on recorded contribution.
- Unwind requires the configured approval policy.
- Escrow policy commitment is created with the project.

For multi-company project stacks, ClearSig should not assume one recipient.
The Fund, Construction, Cooperative, and other operating entities can be
recorded inside one Pro escrow when they share a governance account. If legal
or approval boundaries differ, they should be separate Pro escrows/accounts
linked by the same project reference.

Frontend/backend MVP may store records off-chain, but the v2 program upgrade
should verify the policy commitment before approving execution.

## Privacy

Store minimum public data on-chain:

- action kind
- hashes/commitments
- status
- authorities
- replay protection fields

Sensitive business context can stay encrypted off-chain with hashes on-chain.
Encrypt/private compute can later evaluate policy details without exposing
raw amounts/routes beyond what settlement requires.

## Upgrade Path

1. Ship canonical v2 action helpers and tests.
2. Update frontend signing previews to use v2 action summaries.
3. Update backend prepare endpoints to emit v2 action envelopes.
4. Add Solana program v2 typed action verification.
5. Migrate Pro escrow to v2 typed release/unwind actions.
6. Migrate agent and swap intents to v2.
7. Deprecate vague Custom signing on new product surfaces.

## Devnet Implementation Notes

The first program-side foundation lives in
`programs/clear-wallet/src/utils/clearsign.rs`.

It currently ships:

- stable typed action codes for all v2 action families
- short canonical headlines for signer-facing summaries
- replay envelope validation for wallet name, action id, nonce, expiry, and
  maximum action lifetime
- domain-separated SHA-256 hashing for envelopes, policy commitments, send
  payloads, batch send payloads, milestone release payloads, escrow return
  payloads, agent trade payloads, and richer agent trade approval payloads
- focused unit tests proving action-code stability, replay binding, payload
  binding, and escrow-return binding
- typed proposal account storage for v2 envelopes
- v2 propose, approve, and cancel instructions that verify canonical envelope
  hashes and role-specific vote hashes before changing approval state
- v2 execution gate that re-verifies typed action kind, policy commitment,
  payload hash, envelope hash, approval status, expiry, and timelock before
  marking a typed proposal executed
- SPL-token escrow milestone release execution that re-verifies the typed
  payload hash against the mint, source token account, destination token
  account, recipient owner, amount, escrow id, and milestone id before moving
  tokens from a vault-owned SPL token account
- frontend canonical hash helpers that mirror the program's byte layout for
  payload hashes, envelope hashes, and role-specific vote hashes
- Pro escrow release and return-to-funder helpers that produce typed v2
  envelopes before those actions are routed into wallet signing
- typed proposal cleanup/rent reclamation through the shared proposal cleanup
  path
- typed SOL policy execution for recipient allow/block lists, per-send amount
  caps, extra approvers, extra cooldowns, and velocity caps
- `PolicySpendState`, a wallet-scoped PDA that stores the active typed SOL
  policy commitment, current window start, and lamports spent inside the active
  window so velocity rules are enforced by the program before funds move
- agent trade approval finalization that binds the ClearSign approval to
  venue, market, side, asset id, amount, max leverage, session id, route, and
  risk-check artifact commitments before marking the proposal executed

Action codes are fixed as:

| Code | Action |
| ---: | --- |
| 1 | `send` |
| 2 | `batch_send` |
| 3 | `add_member` |
| 4 | `remove_member` |
| 5 | `change_threshold` |
| 6 | `set_protection` |
| 7 | `release_milestone` |
| 8 | `return_escrow_funds` |
| 9 | `agent_trade_approval` |
| 10 | `recovery_action` |
| 11 | `swap_intent` |
| 12 | `agent_session_grant` |
| 13 | `agent_risk_policy` |
| 14 | `agent_trade_settlement` |
| 15 | `recurring_schedule` |
| 16 | `set_asset_protection` |

Typed proposal instruction discriminators are:

| Code | Instruction |
| ---: | --- |
| 8 | `propose_typed` |
| 9 | `approve_typed` |
| 10 | `cancel_typed` |
| 11 | `execute_typed` |
| 12 | `execute_typed_escrow_release` |
| 13 | `execute_typed_escrow_return` |
| 16 | `cleanup_typed_proposal` |
| 17 | `execute_typed_spl_escrow_release` |
| 18 | `execute_typed_spl_escrow_return` |
| 19 | `execute_typed_cross_chain_escrow_release` |
| 20 | `execute_typed_cross_chain_escrow_return` |
| 21 | `execute_typed_private_escrow_release` |
| 22 | `execute_typed_private_escrow_return` |
| 23 | `execute_typed_agent_trade_approval` |
| 24 | `execute_typed_chain_send` |
| 25 | `ika_sign_typed_chain_send` |
| 26 | `execute_typed_wallet_policy_update` |
| 27 | `execute_typed_intent_governance` |
| 28 | `execute_typed_agent_session_grant` |
| 29 | `execute_typed_agent_risk_policy` |
| 30 | `execute_typed_agent_trade_settlement` |
| 31 | `propose_typed_v4` |
| 32 | `execute_typed_recurring_schedule` |
| 33 | `execute_recurring_payment` |
| 34 | `execute_typed_recurring_token_schedule` |
| 35 | `execute_recurring_token_payment` |
| 36 | `execute_typed_asset_policy_update` |
| 37 | `execute_typed_recurring_asset_schedule` |
| 38 | `execute_recurring_asset_payment` |

`execute_typed` remains the generic status gate. The SOL escrow-specific
executors additionally move SOL from the wallet vault after recomputing the
approved typed payload hash from the recipient account(s), amount(s), escrow id,
and milestone id. The SPL escrow release executor transfers SPL tokens from a
vault-owned token account after binding the approval to the mint, token
accounts, recipient owner, amount, escrow id, and milestone id. The SPL escrow
return executor transfers SPL tokens back to funder token accounts after
binding the approval to the mint, source token account, each destination token
account, each funder owner, each amount, and escrow id. The cross-chain escrow
release executor does not move destination-chain value directly; it finalizes an
already verified external settlement artifact after binding the approval to the
destination chain, IkaConfig/dWallet binding, escrow id, milestone id,
recipient hash, asset id hash, amount, route hash, tx-template hash, and
settlement artifact hash. The cross-chain return executor uses the same
artifact gate under `ReturnEscrowFunds`, binding escrow id, destination chain,
IkaConfig/dWallet binding, refund-recipient commitment, asset id hash, amount,
route hash, tx-template hash, and settlement artifact hash. The private escrow
executors are ciphertext-bound artifact finalizers: they require non-empty
Encrypt ciphertext references on the governing intent and bind execution to the
stored ciphertext-reference hash, private evaluation hash, settlement artifact
hash, recipient/refund commitment, asset id hash, amount, and escrow id.
The agent trade approval executor finalizes a verified agent decision without
placing a venue order directly; it binds the proposal to venue, market, side,
asset id, amount, max leverage, session id, route, and risk-check artifact
commitments so a changed trade/risk digest cannot reuse the human approval.
The recurring schedule executor creates or revokes a schedule PDA only from an
approved v4 `RecurringSchedule` document. The payment executor is permissionless
but transfers exactly one due SOL payment, advances the due time, decrements the
remaining count, and rechecks the wallet's current supported send policy before
funds move. Unsupported proposal-dependent policy rules fail closed during
schedule configuration.

New USDC schedules use CSP2 rather than reusing CSP1 lamport fields. The asset
policy update binds the wallet, SPL mint, decimals, display symbol, replacement
bytes, and stale-current commitment. The recurring asset executor enforces the
same exact token accounts plus amount, recipient, allowed-hours, velocity, and
send-count rules. Velocity and count are recorded in one PDA per wallet and
mint, so creating another schedule does not create another budget. Legacy CSP1
token schedules continue through discriminators 34 and 35 only.

## Security Review Snapshot: 2026-07-04

Reviewed surfaces:

- program ClearSign hashing and replay envelope
- typed proposal propose/approve/cancel/execute instructions
- typed SOL escrow release and return-to-funder executors
- CLI typed proposal builders and account parser
- backend typed proposal prepare/submit routes
- frontend typed proposal parser, PDA derivation, proposal listing, detail
  approval flow, and batch approval flow
- Pro escrow release and return-to-funder typed action creation

Current enforced guarantees:

- Action kind codes are stable and tested.
- Typed proposal PDAs use a separate `typed_proposal` namespace and cannot
  collide with legacy proposal PDAs for the same intent/index.
- Propose signatures bind vote kind, wallet PDA, proposal index, and envelope
  hash.
- Approve/cancel signatures bind their own vote kind, wallet PDA, proposal
  index, and the stored envelope hash.
- The program rejects expired typed proposals and proposals whose expiry is too
  far in the future.
- The program recomputes the envelope hash from action kind, wallet name,
  wallet PDA, action id, nonce, expiry, policy commitment, and payload hash.
- Execute rechecks action kind, policy commitment, payload hash, envelope hash,
  approval status, expiry, and timelock before marking the typed proposal
  executed.
- Typed SOL escrow release and return-to-funder executors recompute the payload
  hash from the actual destination account(s) and amount(s) before moving funds.
- Typed SPL-token escrow release recomputes the payload hash from the actual
  mint, source token account, destination token account, recipient owner,
  amount, escrow id, and milestone id before moving tokens.
- Typed cross-chain escrow release recomputes the payload hash from the actual
  IkaConfig/dWallet binding, destination chain, tx-template hash, route hash,
  settlement artifact hash, recipient hash, asset id hash, amount, escrow id,
  and milestone id before marking the proposal executed.
- Typed cross-chain escrow return recomputes the payload hash from the actual
  IkaConfig/dWallet binding, destination chain, tx-template hash, route hash,
  settlement artifact hash, refund-recipient hash, asset id hash, amount, and
  escrow id before marking the proposal executed.
- Typed private escrow release/return recomputes the payload hash from the
  actual intent ciphertext-reference hash, private evaluation hash, settlement
  artifact hash, recipient/refund commitment, asset id hash, amount, and escrow
  id before marking the proposal executed. The program requires non-empty
  ciphertext references and does not claim to decrypt or evaluate private
  policy values.
- Typed agent trade approval recomputes the payload hash from the exact
  committed venue, market, side, asset id, amount, max leverage, session id,
  route, and risk-check artifact before marking the proposal executed.
- Typed SOL send enforces committed policy bytes before transfer. For velocity
  rules, execution initializes or updates the wallet's `PolicySpendState`; a
  policy commitment change resets that meter, and a send that would exceed the
  committed window cap fails before lamports leave the vault.
- Escrow release and escrow return payload hashes are domain-separated and
  tested so they cannot be swapped under the same signer approval.
- Frontend typed proposal account parsing and typed PDA derivation are covered
  by regression tests.
- Legacy and typed proposals now have regression coverage proving they share
  the same monotonic wallet proposal index while staying in separate PDA
  namespaces.
- Typed proposal cleanup closes finalized typed proposal accounts through the
  same CLI/backend cleanup command used for legacy proposals.
- A deployed-devnet typed SOL flow check covers typed SOL send, SOL escrow
  milestone release, SOL escrow return-to-funders, proposal status verification,
  and typed proposal rent cleanup:

  ```bash
  PAYER_KEYPAIR=/path/to/funded-devnet-keypair.json \
    cargo run -p e2e-clear-msig-ika --bin e2e-typed-sol-devnet
  ```

Current explicit limitation:

- Typed SOL escrow release/return, SPL-token milestone release/return,
  cross-chain BTC/EVM/Ika escrow release/return, and ciphertext-bound private
  escrow release/return now have program executors. Agent session grant/revoke
  and bounded trade-approval finalization also have typed program executors,
  but venue order placement and settlement reconciliation still need dedicated
  backend/program integration. Full Encrypt/FHE
  policy evaluation still needs program-side confidential enforcement before
  private policy values should be treated as fully enforced on-chain.

## Cross-Chain Send Assurance

ClearSig keeps an explicit frontend assurance matrix for the non-Solana send
paths that still use chain-native transaction templates:

- ETH: `examples/intents/evm_transfer_sepolia.json`, `/send/eth`
- BTC: `examples/intents/btc_transfer.json`, `/send/btc`
- ZEC: `examples/intents/zcash_transfer.json`, `/send/zec`
- HYPE: `examples/intents/hyperliquid_transfer.json`,
  `/send/eth?network=hyperliquid`

Each row must stay send-ready, show a signer preview, require a wallet proposal
approval, execute through the ClearSig proposal path, and broadcast only after
execute. The regression coverage lives in
`apps/web/src/lib/chain/clearsignAssurance.ts` and its tests.

## Next Typed Executor Order

1. **Agent venue-settlement execution**
   - Connect the agent trade approval finalizer to backend venue placement
     records so order ids, fills, and reconciliation artifacts are committed
     back to ClearSign.
   - Add tests proving a stale session, changed venue route, or changed risk
     artifact cannot reuse a prior approval.
2. **Production Encrypt/FHE enforcement**
   - Replace ciphertext-bound artifact finalization with program-side Encrypt
     handlers once the runtime is available.
   - Keep the same public commitment shape so signer-facing text, payload hash,
     and policy commitment do not diverge between plaintext fallback and
     encrypted evaluation paths.
   - Add tests proving encrypted evaluator failures cannot be bypassed by
     reusing stale ciphertext, policy, or settlement artifact commitments.

## External Review Handoff Checklist

Before the next external review, collect:

- final devnet program id, program-data address, and upgrade authority
- deployed program slot and binary size
- SBF artifact hash from CI and deploy command logs
- test output for typed SVM execution, typed cleanup, compatibility tests, CLI
  discriminator tests, and the deployed-devnet typed SOL e2e binary
- list of intentionally unsupported typed executors and the user-facing labels
  that keep them out of production claims
- upgrade authority custody plan, rotation plan, and emergency freeze policy

Required before mainnet:

- Add production Encrypt/FHE enforcement for private escrow policies.
- Add migration/compatibility tests for legacy proposals and typed proposals
  coexisting in the same wallet proposal index space for every product route
  that lists or cleans proposals.
- Keep the deployed-devnet typed SOL send/release/return end-to-end check
  passing against the final deployed program bytes.
- Re-run external review on the final deployed program ID / upgrade authority
  setup.

## Non-Negotiables

- Human text must match canonical bytes.
- The same action must hash the same way across frontend, backend, and program.
- Failure messages must say what happened and one next step.
- Infrastructure details stay behind Details.
- Devnet must be boring before mainnet.
