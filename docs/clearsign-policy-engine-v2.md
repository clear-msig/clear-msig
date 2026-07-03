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

## Non-Negotiables

- Human text must match canonical bytes.
- The same action must hash the same way across frontend, backend, and program.
- Failure messages must say what happened and one next step.
- Infrastructure details stay behind Details.
- Devnet must be boring before mainnet.
