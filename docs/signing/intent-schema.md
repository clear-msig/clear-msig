# ClearSign v4 intent schema

## Authority model

ClearSign v4 uses the allocator-free Rust crate `crates/clear-msig-signing` as
the canonical schema, codec, commitment, and renderer implementation. The API
normalizes requests into this schema. The browser consumes the prepared result;
it does not define transaction meaning. The Solana program parses the same bytes
and derives the payload hash and readable document again.

The wire format is binary rather than JSON. Every field is ordered, integers are
little-endian, and variable fields are `u16` length-prefixed. Unknown versions,
action codes, networks, profiles, encodings, required trailing fields, or
trailing bytes are rejected.

## Common field order

1. Magic `CSIGINT4`
2. Version `4`
3. Device profile
4. Action kind
5. Network
6. Proposal index (`u64`)
7. Wallet ID (32 bytes)
8. Actor (32 bytes)
9. Action ID (32-byte replay hash)
10. Nonce (32-byte replay hash)
11. Expiry (`i64` Unix timestamp)
12. Policy commitment (32 bytes)
13. Required approvals (`u8`)
14. Action-specific fields
15. Transfer-only informational fiat snapshot flag and fields
16. Optional reason as validated visible ASCII

Amounts are unsigned atomic-unit integers (`u128`) plus an explicit decimals
value. Floating-point amounts are never canonical. Display symbols are
non-authoritative; asset identity and raw amount are authoritative.

## Identity encodings

- `Text`: visible ASCII is used directly in the payload commitment.
- `SolanaPubkey`: exactly 32 bytes, rendered as full base58.
- `Sha256Text`: the full visible source text is retained and shown; the payload
  commitment uses its SHA-256 digest to match remote-chain executors.

No Unicode or control characters are accepted in canonical user-visible text.
This prevents newline, delimiter, bidi, and confusable-label injection.

## Executable schemas

| Template | Canonical action | Enforcement |
| --- | --- | --- |
| Native/token/cross-chain transfer | `Send` | Program executor recomputes recipient, asset, raw amount, network, policy, and execution template commitment |
| Batch payment | `BatchSend` | Every ordered row is recomputed |
| Member add/remove and threshold change | Governance action | Final proposer/approver sets, thresholds, timelock, and target intent are recomputed |
| Wallet policy update | `SetProtection` | Current policy is read from chain; replacement bytes and chain kind are committed |
| Asset policy update | `SetAssetProtection` | Current asset policy is read from the wallet-and-asset PDA; CSP2 replacement bytes, scope, mint, decimals, and symbol are committed |
| Recurring SOL / USDC | `RecurringSchedule` | Amount, recipient, cadence, count, policy, and exact SPL execution accounts are recomputed; CSP2 USDC spend windows are shared by wallet and mint |
| Escrow release/return | Escrow actions | Every transfer plus SPL, Ika, or private settlement evidence is recomputed |
| Agent grant/revoke | `AgentSessionGrant` | Session identity, venue, market, budget, leverage, expiry, and status are recomputed |
| Agent budget/risk change | `AgentRiskPolicy` | Session, loss cap, oracle policy, and status are recomputed |
| Agent trade approval/settlement | Agent actions | Trade limits or settlement sequence and immutable artifact evidence are recomputed |

## Review-only schemas

Swap, arbitrary contract/program interaction, staking, unstaking, governance
vote, and unknown-action entries exist in the template registry as
`ReviewOnly`. `render_unsupported_review` emits an explicit unknown-risk warning
and states that approval is disabled. These entries cannot become a v4 approval
envelope and are not accepted as executable proposals.

This is deliberate. A readable description without a matching executor would
not be clear signing.

## Informational values

Fresh fiat estimates are optional canonical review context containing decimal
amount, currency, source identifier, observation time, and an explicit
informational-only assertion. They alter the canonical and document hashes so
the signer sees exactly the recorded estimate, but are intentionally excluded
from the executable payload hash. Only raw asset units, decimals, asset
identity, destination, and execution evidence authorize movement. The backend
rejects estimates older than five minutes, too far in the future, non-USD, or
not explicitly informational.
