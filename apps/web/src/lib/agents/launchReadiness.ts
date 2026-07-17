export type TradingLaunchVenue = "mock_perps" | "hyperliquid_testnet";

export type TradingLaunchStepId =
  | "trader"
  | "plan"
  | "safety"
  | "allowance"
  | "disclosures"
  | "automatic"
  | "account"
  | "funding"
  | "protected_connection"
  | "first_idea"
  | "first_trade";

export interface TradingLaunchChecks {
  hasTrader: boolean;
  traderActive: boolean;
  planReady: boolean;
  safetyReady: boolean;
  allowanceReady: boolean;
  disclosuresAccepted: boolean;
  automaticTradingOn: boolean;
  accountReady: boolean;
  accountFunded: boolean;
  protectedConnectionReady: boolean;
  hasTraderIdea: boolean;
  firstTradePlaced: boolean;
}

export interface TradingLaunchStep {
  id: TradingLaunchStepId;
  label: string;
  description: string;
  owner: "you" | "trader" | "host" | "clearsig";
  status: "done" | "current" | "waiting";
}

export interface TradingLaunchState {
  venue: TradingLaunchVenue;
  steps: TradingLaunchStep[];
  currentStep: TradingLaunchStep | null;
  completedSteps: number;
  totalSteps: number;
  complete: boolean;
  canPlaceFirstTrade: boolean;
  modeLabel: string;
  statusLabel: string;
  statusTone: "ready" | "warning" | "blocked";
  primaryActionLabel: string;
}

export function buildTradingLaunchSteps(
  venue: TradingLaunchVenue,
  checks: TradingLaunchChecks,
): TradingLaunchStep[] {
  const drafts: Array<Omit<TradingLaunchStep, "status"> & { done: boolean }> = [
    {
      id: "trader",
      label: "Choose trader",
      description: "Pick the prepared trader you want to try.",
      owner: "you",
      done: checks.hasTrader && checks.traderActive,
    },
    {
      id: "plan",
      label: "Review style",
      description: "Check what it trades and when it exits.",
      owner: "you",
      done: checks.planReady,
    },
    {
      id: "safety",
      label: "Set max loss",
      description: "Choose how much it can risk before ClearSig stops it.",
      owner: "you",
      done: checks.safetyReady,
    },
    {
      id: "allowance",
      label: "Set budget",
      description: "Choose the practice amount, open trades, and time limit.",
      owner: "you",
      done: checks.allowanceReady,
    },
    {
      id: "disclosures",
      label: "Review trading disclosures",
      description:
        "Confirm what practice trading, automation, leverage, creator agents, and future fees mean.",
      owner: "you",
      done: checks.disclosuresAccepted,
    },
  ];

  if (venue === "hyperliquid_testnet") {
    drafts.push(
      {
        id: "account",
        label: "Connect practice account",
        description: "Use a separate practice account. Never use your main wallet.",
        owner: "you",
        done: checks.accountReady,
      },
      {
        id: "funding",
        label: "Add practice funds",
        description: "Hyperliquid needs practice funds before it can place a trade.",
        owner: "you",
        done: checks.accountFunded,
      },
      {
        id: "protected_connection",
        label: "Confirm the protected trading connection",
        description: "The person hosting ClearSig connects the separate trading wallet and keeps its secret private.",
        owner: "host",
        done: checks.protectedConnectionReady,
      },
    );
  }

  drafts.push(
    {
      id: "automatic",
      label: "Turn on automatic trading",
      description: "ClearSig may act without asking each time, but only inside the current budget.",
      owner: "you",
      done: checks.automaticTradingOn,
    },
    {
      id: "first_idea",
      label: "Receive the trader's first idea",
      description: "Connect the trader and ask it to send one small practice idea.",
      owner: "trader",
      done: checks.hasTraderIdea,
    },
    {
      id: "first_trade",
      label: "Place the first practice trade",
      description:
        venue === "hyperliquid_testnet"
          ? "ClearSig checks the idea again, then the connected practice account places the trade."
          : "ClearSig checks the idea again, then opens the built-in practice trade.",
      owner: "clearsig",
      done: checks.firstTradePlaced,
    },
  );

  const currentIndex = drafts.findIndex((step) => !step.done);
  return drafts.map((step, index) => ({
    id: step.id,
    label: step.label,
    description: step.description,
    owner: step.owner,
    status: step.done ? "done" : index === currentIndex ? "current" : "waiting",
  }));
}

export function buildTradingLaunchState(
  venue: TradingLaunchVenue,
  checks: TradingLaunchChecks,
): TradingLaunchState {
  const steps = buildTradingLaunchSteps(venue, checks);
  const currentStep = steps.find((step) => step.status === "current") ?? null;
  const completedSteps = steps.filter((step) => step.status === "done").length;
  const complete = completedSteps === steps.length;
  const protectedVenueBlocked =
    venue === "hyperliquid_testnet" &&
    (currentStep?.id === "protected_connection" ||
      (!checks.protectedConnectionReady &&
        steps.some((step) => step.id === "protected_connection")));

  return {
    venue,
    steps,
    currentStep,
    completedSteps,
    totalSteps: steps.length,
    complete,
    canPlaceFirstTrade: complete || currentStep?.id === "first_trade",
    modeLabel:
      venue === "hyperliquid_testnet"
        ? "Connected practice"
        : "Built-in practice",
    statusLabel: complete
      ? "Ready"
      : protectedVenueBlocked
        ? "Host setup needed"
        : currentStep?.label ?? "Checking",
    statusTone: complete
      ? "ready"
      : protectedVenueBlocked
        ? "blocked"
        : "warning",
    primaryActionLabel: complete
      ? "Monitor trades"
      : currentStep?.label ?? "Next step",
  };
}
