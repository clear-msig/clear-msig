# ClearSign message templates

## Registry

`crates/clear-msig-signing/src/templates.rs` is the single capability registry.
Every entry is explicitly `Executable` or `ReviewOnly`.

Executable templates are native transfer, token transfer, batch payment, policy
update, member add/remove, threshold change, escrow release/return, agent
permission grant/revoke, agent budget/risk change, agent trade approval,
agent settlement, and cross-chain transfer.

Swap, contract interaction, staking, unstaking, governance vote, and unknown
action are review-only until an action-specific executor can reconstruct and
verify the exact transaction.

## Full template

The full renderer is human-first and includes action-specific authoritative
fields, wallet, network, amounts, complete destinations, policy commitment,
display protocol, risk category, signer check, and purpose. The typed vote
suffix adds proposal state, requested signer, expiry, and envelope proof.
Fresh fiat snapshots, when available, show amount, currency, source, and Unix
observation time with an explicit informational label.

Risk text is a signer instruction derived from action type. It does not claim a
recipient is trusted, a destination is known, or an action is low risk. Policy
text states only what is actually enforced: the committed payload, policy,
threshold, and timelock.

## Compact template

The Ledger Solana profile uses deterministic uppercase field labels with full
amounts, assets, destinations, network, wallet, threshold, proposal, expiry,
policy commitment, and execution evidence. It omits optional purpose text. It
does not use a hash-only fallback.

## Unknown action template

Unknown or unsupported transactions render as `ClearSig Review Required`, show
the network, program or contract, and full transaction commitment, classify risk
as unknown, and state `Approval is disabled`. This review cannot be converted
into an executable v4 proposal.
