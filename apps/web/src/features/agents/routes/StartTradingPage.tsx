"use client";

import { useStartTradingController } from "@/features/agents/controllers/useStartTradingController";
import { StartTradingScreen } from "@/features/agents/ui/start/StartTradingScreen";

export default function StartTradingPage() {
  const controller = useStartTradingController();
  return <StartTradingScreen controller={controller} />;
}
