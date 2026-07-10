"use client";

// Browser-facing adapter for the agent feature. UI and route modules import
// feature domain types; controller modules use this port for persistence,
// network polling, wallet signing, and backend synchronization.
export * from "@/lib/agents/client";
export * from "@/lib/agents/clientAutonomy";
export * from "@/lib/agents/clientExecution";
export * from "@/lib/agents/clientInbox";
export * from "@/lib/agents/clientMarketData";
export * from "@/lib/agents/useAgentTypedClearSignApproval";
export { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
export type { AgentServerWalletState } from "@/lib/agents/serverState";
