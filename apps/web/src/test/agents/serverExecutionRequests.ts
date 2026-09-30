import * as execution from "@/lib/agents/serverExecutionRequests";
import { withAgentTestWallet } from "./walletScope";
export { hashAgentServerExecutionArtifact, agentServerExecutionStorageMode } from "@/lib/agents/serverExecutionRequests";
export type { AgentServerExecutionRecord } from "@/lib/agents/serverExecutionRequests";
export const recordAgentServerExecutionRequest = (input: Parameters<typeof execution.recordAgentServerExecutionRequest>[0]) => withAgentTestWallet(input.request.walletName, () => execution.recordAgentServerExecutionRequest(input));
export const recordAgentServerExecutionSettlement = (input: Parameters<typeof execution.recordAgentServerExecutionSettlement>[0]) => withAgentTestWallet(input.walletName, () => execution.recordAgentServerExecutionSettlement(input));
export const recordAgentServerExecutionSettlementProof = (input: Parameters<typeof execution.recordAgentServerExecutionSettlementProof>[0]) => withAgentTestWallet(input.walletName, () => execution.recordAgentServerExecutionSettlementProof(input));
export const listAgentServerExecutionRequests = (...args: Parameters<typeof execution.listAgentServerExecutionRequests>) => withAgentTestWallet(args[0], () => execution.listAgentServerExecutionRequests(...args));
