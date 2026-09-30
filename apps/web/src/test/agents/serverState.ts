import * as state from "@/features/agents/server/serverState";
import { withAgentTestWallet } from "./walletScope";
export type { AgentServerWalletState } from "@/features/agents/server/serverState";
export { AgentServerStateConflictError, AgentServerStatePersistenceError, agentServerStateStorageMode,
  agentServerStatePersistenceStatus } from "@/features/agents/server/serverState";

type WalletPayload = { walletName: string };
function payloadScoped<Args extends [WalletPayload, ...unknown[]], Result>(fn: (...args: Args) => Promise<Result>) {
  return (...args: Args) => withAgentTestWallet(args[0].walletName, () => fn(...args));
}
function nameScoped<Args extends [string, ...unknown[]], Result>(fn: (...args: Args) => Promise<Result>) {
  return (...args: Args) => withAgentTestWallet(args[0], () => fn(...args));
}
export const getAgentServerWalletState = nameScoped(state.getAgentServerWalletState);
export const saveAgentServerProfile = payloadScoped(state.saveAgentServerProfile);
export const saveAgentServerVaultPolicy = payloadScoped(state.saveAgentServerVaultPolicy);
export const saveAgentServerOwnerApproval = payloadScoped(state.saveAgentServerOwnerApproval);
export const saveAgentServerSession = payloadScoped(state.saveAgentServerSession);
export const saveAgentServerProposal = payloadScoped(state.saveAgentServerProposal);
export const saveAgentServerExecution = payloadScoped(state.saveAgentServerExecution);
export const hasAgentServerWalletSignedOwnerApproval = payloadScoped(state.hasAgentServerWalletSignedOwnerApproval);
export const updateAgentServerSessionStatus = payloadScoped(state.updateAgentServerSessionStatus);
export const validateAgentServerExecutionHandoff = payloadScoped(state.validateAgentServerExecutionHandoff);
export const evaluateAgentServerProposal = payloadScoped(state.evaluateAgentServerProposal);
export const approveAgentServerProposal = nameScoped(state.approveAgentServerProposal);
export const rejectAgentServerProposal = nameScoped(state.rejectAgentServerProposal);
export const setAgentServerEmergencyPause = nameScoped(state.setAgentServerEmergencyPause);
export const agentServerLeaderboard = nameScoped(state.agentServerLeaderboard);
