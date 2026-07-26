"use client";

import { useAgentLibraryController } from "@/features/agents/controllers/useAgentLibraryController";
import { AgentLibraryScreen } from "@/features/agents/ui/library/AgentLibraryScreen";

export default function TraderLibraryPage() {
  const controller = useAgentLibraryController();
  return <AgentLibraryScreen controller={controller} />;
}
