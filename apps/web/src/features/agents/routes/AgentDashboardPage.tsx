"use client";

import { useAgentDashboardController } from "@/features/agents/controllers/useAgentDashboardController";
import { AgentDashboardScreen } from "@/features/agents/ui/dashboard/AgentDashboardScreen";

export default function AgentsPage() {
  const controller = useAgentDashboardController();
  return <AgentDashboardScreen controller={controller} />;
}
