import { executeAllowedAgentProposal as execute } from "@/lib/agents/serverAutomaticExecution";
import { runAgentAutonomyTick as tick } from "@/lib/agents/serverAutonomousTrading";
import { importAgentInboxSignals as importSignals } from "@/lib/agents/serverInboxImport";
import { withAgentTestWallet } from "./walletScope";
export const executeAllowedAgentProposal = (input: Parameters<typeof execute>[0]) => withAgentTestWallet(input.walletName, () => execute(input));
export const runAgentAutonomyTick = (input: Parameters<typeof tick>[0]) => withAgentTestWallet(input.walletName, () => tick(input));
export const importAgentInboxSignals = (input: Parameters<typeof importSignals>[0]) => withAgentTestWallet(input.walletName, () => importSignals(input));
