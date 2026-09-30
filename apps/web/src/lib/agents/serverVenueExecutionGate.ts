/**
 * No live adapter is registered yet. These are implementation requirements,
 * not deploy-time feature flags. Testnet uses the same authority requirements.
 */
export const AGENT_VENUE_BRIDGE_BLOCKERS = [
  "Reviewed integration of finalized authority, dedicated accounts and durable delivery adapters",
  "Versioned threshold-approved venue limits and exact order preparation",
  "Independently reconciled atomic stop-loss order adapter",
  "Threshold-authorized close and emergency-stop contracts",
  "Execution-linked native settlement accounting and evidence promotion",
] as const;

export const AGENT_VENUE_EXECUTION_BLOCKED_MESSAGE =
  "External agent execution is blocked until dedicated wallet accounts, per-trade threshold approval, durable reconciliation, and stop-loss protection are connected and verified.";

export function assertExternalAgentExecutionEnabled(): void {
  throw new Error(AGENT_VENUE_EXECUTION_BLOCKED_MESSAGE);
}
