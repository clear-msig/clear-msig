"use client";

import { useAgentDetailController } from "@/features/agents/controllers/useAgentDetailController";
import { AgentDetailScreen } from "@/features/agents/ui/detail/AgentDetailScreen";

export default function AgentDetailPage() {
  const controller = useAgentDetailController();
  return <AgentDetailScreen controller={controller} />;
}
