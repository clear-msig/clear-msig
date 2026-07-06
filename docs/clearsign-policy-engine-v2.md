# ClearSign Policy Engine v2

Status: implementation starting on devnet.

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

ClearSig v2 follows:

1. Browser explains the typed action.
2. Backend prepares and simulates the action.
3. Solana verifies the canonical action and policy commitment.
4. Signer signs the same canonical text/hash.
5. Chain enforces before money or authority moves.

## Typed Actions

Every action that requires a wallet signature must have a versioned action
type. The initial v2 action families are:

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

Every v2 action uses the same envelope:

```json
{
  "version": 2,
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
  payloads, and agent trade payloads
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

`execute_typed` remains the generic status gate. The SOL escrow-specific
executors additionally move SOL from the wallet vault after recomputing the
approved typed payload hash from the recipient account(s), amount(s), escrow id,
and milestone id. The SPL escrow release executor transfers SPL tokens from a
vault-owned token account after binding the approval to the mint, token
accounts, recipient owner, amount, escrow id, and milestone id. The SPL escrow
return executor transfers SPL tokens back to funder token accounts after
binding the approval to the mint, source token account, each destination token
account, each funder owner, each amount, and escrow id.

## Security Review Snapshot: 2026-07-04

Reviewed surfaces:

- program ClearSign v2 hashing and replay envelope
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
- Escrow release and escrow return payload hashes are domain-separated and
  tested so they cannot be swapped under the same signer approval.
- Frontend typed proposal account parsing and typed PDA derivation are covered
  by regression tests.
- Legacy and typed proposals now have regression coverage proving they share
  the same monotonic wallet proposal index while staying in separate PDA
  namespaces.
- Typed proposal cleanup closes finalized typed proposal accounts through the
  same CLI/backend cleanup command used for legacy proposals.
- A deployed-devnet typed SOL flow check is available with:

  ```bash
  PAYER_KEYPAIR=/path/to/funded-devnet-keypair.json \
    cargo run -p e2e-clear-msig-ika --bin e2e-typed-sol-devnet
  ```

Current explicit limitation:

- Typed SOL escrow release/return and SPL-token milestone release/return now
  have program executors. BTC/EVM/Ika escrow and encrypted private escrow still
  need their own typed executors before they should be treated as
  cryptographically enforced.

## Next Typed Executor Order

1. **Cross-chain BTC/EVM/Ika escrow**
   - Treat the typed executor as an authorization/artifact gate, not a direct
     Solana value movement.
   - Bind the approved typed payload to the destination chain, dWallet/Ika
     config, escrow id, recipient, amount, route/tx template, and settlement
     artifact hash.
   - Require the CLI/backend to return verified chain artifacts before marking
     external execution complete.
   - Add replay/idempotency tests so the same artifact cannot finalize a
     different proposal, escrow, chain, or amount.
2. **Encrypted/private escrow**
   - Wait for program-side Encrypt/FHE enforcement. Until then, private escrow
     can produce typed commitments but must not claim confidential on-chain
     policy enforcement.
   - The executor should verify ciphertext/commitment references and only reveal
     settlement-minimum public fields.
   - Add tests proving plaintext fallback and encrypted paths cannot diverge in
     signer-facing text, payload hash, or policy commitment.

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

- Add cross-chain typed escrow executors.
- Add migration/compatibility tests for legacy proposals and typed proposals
  coexisting in the same wallet proposal index space for every product route
  that lists or cleans proposals.
- Add deployed-devnet end-to-end tests for typed SOL escrow release/return
  using deployed program bytes.
- Re-run external review on the final deployed program ID / upgrade authority
  setup.

## Non-Negotiables

- Human text must match canonical bytes.
- The same action must hash the same way across frontend, backend, and program.
- Failure messages must say what happened and one next step.
- Infrastructure details stay behind Details.
- Devnet must be boring before mainnet.
