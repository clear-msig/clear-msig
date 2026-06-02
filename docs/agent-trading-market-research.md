# Agent Trading Market Research

Status: locked as product direction for the Agent Trading Vault MVP.

## What The Market Is Doing

Current agent-trading experiments are converging around a simple pattern:

- AI coding agent or desktop assistant,
- MCP or API bridge to an exchange,
- user-written strategy file,
- exchange API key,
- risk rules added after the fact.

Examples found during research:

- Bybit official MCP server: https://github.com/bybit-exchange/trading-mcp
- Community CCXT MCP server: https://github.com/lazy-dinosaur/ccxt-mcp
- Coinbase AgentKit: https://docs.cdp.coinbase.com/agentkit/docs/agent-actions
- Coinbase AgentKit actions: https://docs.cdp.coinbase.com/agent-kit/core-concepts/agents-actions
- TradingView MCP discussions on Reddit for screening, indicators, and multi-exchange workflows.
- Deribit and Robinhood MCP discussions on Reddit for direct natural-language trading.

## Product Takeaway

The market wants:

- natural-language strategy setup,
- fast exchange/venue connectivity,
- paper-to-live progression,
- risk caps,
- kill switches,
- position visibility,
- PnL tracking,
- simple controls.

But the weak point is that many demos connect an agent directly to exchange power.
ClearSig should not copy that blindly.

ClearSig's wedge is:

> Agents can trade only through bounded, observable, revocable authority.

## MVP Flow Update

The MVP should feel as simple as:

1. Register trading agent.
2. Write strategy playbook.
3. Set risk limits.
4. Start with paper trading.
5. Grant a bounded trading session.
6. Review signals, sessions, positions, PnL, and logs.
7. Recheck blocked signals after fixing risk.
8. Renew sessions deliberately instead of reusing revoked authority.

## Strategy Playbook Requirements

Each agent needs a strategy playbook with:

- operating mode: read-only, paper trading, bounded live,
- allowed markets,
- entry rules,
- exit rules,
- risk rules,
- execution protocol,
- kill switch rules.

This maps to the familiar `CLAUDE.md` strategy-file pattern, but keeps it inside
ClearSig's UI and policy system.

## Risk Gate Requirements

The agent's strategy is not the authority. The risk gate is.

Required controls:

- emergency pause,
- max notional,
- max leverage,
- max open positions,
- cooldown,
- stop-loss requirement,
- take-profit requirement,
- session expiry,
- venue allowlist,
- market allowlist,
- paper/live mode boundary.

## Security Notes

MCP-style tooling is useful for adapters and market data, but direct tool access
has security risks: prompt injection, malicious tools, unsafe command execution,
and weak trust boundaries.

ClearSig should treat external MCP/exchange adapters as backend-only execution
connectors. The app should not put exchange secrets or agent private keys in
public frontend variables.

## ClearSig Positioning

Most tools are trying to make it easy for an AI assistant to trade.

ClearSig should make it safe for a group to let agents trade.

That means:

- no raw wallet custody for agents,
- no unconditional exchange authority,
- bounded sessions,
- auditable signals and executions,
- revocation and recovery paths,
- paper trading before live execution,
- policy checks before every action.
