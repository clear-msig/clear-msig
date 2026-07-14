# Agent Vault product contract

Agent Vault is an independent ClearSig wallet product for bounded delegated
capital. It is not a submenu, automation toggle, or feature inside Pro.

## User model

1. A Pro user creates a separate Agent Vault wallet.
2. The owner allocates a specific amount from a Pro treasury through a normal,
   governed ClearSign transfer to the Agent Vault address.
3. The owner selects an agent/strategy and grants a narrow session: venue,
   assets, markets, notional, leverage, position count, expiry, and policy hash.
4. The agent may propose or execute only inside that active grant and the
   wallet's on-chain protection policy.
5. The owner can pause, revoke, withdraw, or decline renewal independently of
   the agent and relayer.

The wallet balance is the capital boundary. A recommendation or paper-trading
budget is not funding, and a local UI setting is not authority.

## Required invariants

- Allocation never grants authority beyond the transferred balance.
- Session limits can only narrow wallet policy, never weaken it.
- Venue route, recipient, asset, amount, leverage, session, and risk artifact
  are committed in the typed approval.
- Expired, revoked, stale-policy, paused, or over-limit sessions fail in a
  trusted execution layer.
- Agent-generated calldata is treated as hostile input and reconstructed from
  approved canonical fields.
- Withdrawals return through owner-governed wallet execution; the agent cannot
  change the withdrawal recipient.
- Kill and revoke paths remain available when the agent service, backend, venue,
  or notification service is unavailable.
- Paper, testnet, and real-capital performance are never combined without an
  explicit provenance label.

## Product surfaces

- **Receive / deposit:** shows the Agent Vault's chain-native funding address.
- **Allocate from Pro:** opens a governed Pro send with the Agent Vault address
  prefilled. It does not silently move money.
- **Capital:** reports actual vault balances separately from session budgets.
- **Strategy:** defines agent intent and allowed markets.
- **Session:** grants bounded, expiring authority tied to current policy.
- **Activity:** shows proposals, approvals, venue receipts, positions, and exits.
- **Safety:** pause, revoke, withdrawal, and recovery controls.

## Current pre-alpha qualification

ClearSig currently supports the wallet, governed allocation path, policy-bound
session model, typed agent approvals, paper execution, and experimental venue
adapters. It does not yet provide production distributed Ika signing or audited
real-capital autonomous execution. Those are release blockers, not UI tasks.
