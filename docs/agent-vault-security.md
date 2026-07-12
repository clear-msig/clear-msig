# Agent Vault security model

This document describes the current pre-alpha trust model. It is not a claim
that autonomous trading is production-safe.

## On-chain authority

An agent trade requires all of the following program-owned state:

1. An active `AgentSession` PDA bound to wallet, agent, venue, market, policy,
   cumulative notional, leverage, and expiry.
2. An active `AgentRiskLedger` PDA bound to the same wallet and session.
3. A threshold-approved typed `AgentTradeApproval` whose payload commits to
   amount, asset, side, venue, market, route, session, leverage, and risk-check
   artifact.

Trade approval atomically increments cumulative session notional and open risk
exposure. Solana account write locks serialize simultaneous attempts against
the same session and ledger. A client cannot omit the risk ledger because its
PDA, owner, wallet, and session are verified by the program.

## Loss policy

Threshold owners set or pause an `AgentRiskPolicy` through typed ClearSign.
The policy commits to a maximum realized loss and an oracle-policy hash.
Accounting is preserved when policy settings change. The oracle policy cannot
change while exposure remains open.

## Settlement

`AgentTradeSettlement` is a separate threshold-approved ClearSign action. It
commits to:

- session and execution identities;
- immutable settlement-artifact hash;
- oracle-policy hash;
- closed notional;
- profit, loss, or flat outcome and absolute P/L;
- exact settlement sequence.

The program closes open exposure, advances the sequence, records realized
loss, and creates a receipt PDA keyed by artifact hash. Sequence checks prevent
reordering; receipt existence prevents artifact replay. Reaching the loss cap
pauses the risk ledger and revokes the agent session atomically.

## Honest limitations

Settlement is currently **owner-attested**, not trustless. ClearSign proves
that the wallet threshold approved the exact settlement artifact and
accounting fields. The program does not yet verify a native Hyperliquid,
exchange, or independent oracle signature. A compromised adapter cannot alter
approved fields, but it can present false source data to owners before they
approve it.

Production use still requires native venue/oracle attestation verification,
distributed Ika MPC, independent adapter review, monitoring, and an external
audit. Until then Agent Vault remains pre-alpha and unsuitable for real funds.
