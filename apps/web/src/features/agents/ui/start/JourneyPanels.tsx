"use client";

import clsx from "clsx";
import { Check, Circle, FileCheck2, Info, Lightbulb, Play, PlugZap, ShieldCheck, SlidersHorizontal, TrendingUp, UserRound, WalletCards, Zap, type LucideIcon } from "lucide-react";
import { type AgentProfile, type TradingLaunchStep, type TradingLaunchState, type TradingLaunchVenue } from "@/features/agents/domain";
import { ownerLabel, venueLabel } from "@/features/agents/ui/start/presentation";

export function BetaJourneyPanel({
  venue,
  agent,
  steps,
  complete,
}: {
  venue: TradingLaunchVenue;
  agent: AgentProfile | null;
  steps: TradingLaunchStep[];
  complete: boolean;
}) {
  const done = (ids: TradingLaunchStep["id"][]) =>
    ids.every((id) => steps.find((step) => step.id === id)?.status === "done");
  const journey = [
    {
      label: "Choose trader",
      detail: agent?.name ?? "No trader selected",
      done: done(["trader", "plan"]),
      Icon: UserRound,
    },
    {
      label: "Set budget",
      detail: venueLabel(venue),
      done: done(["safety", "allowance"]),
      Icon: SlidersHorizontal,
    },
    {
      label: "Accept disclosures",
      detail: "Automation terms",
      done: done(["disclosures"]),
      Icon: Info,
    },
    {
      label: "Turn on automation",
      detail: "Inside budget only",
      done: done(["automatic"]),
      Icon: Zap,
    },
    {
      label: "Watch trades",
      detail: complete ? "First trade placed" : "Waiting for first trade",
      done: done(["first_trade"]),
      Icon: Play,
    },
  ];
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-strong">
            Launch checklist
          </p>
        </div>
        <span className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-1 text-[11px] font-medium text-accent">
          {venue === "hyperliquid_testnet" ? "Connected practice" : "Built-in practice"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        {journey.map((item) => {
          const Icon = item.Icon;
          return (
            <div
              key={item.label}
              className={clsx(
                "min-w-0 rounded-soft border px-3 py-2",
                item.done
                  ? "border-accent/25 bg-accent/[0.06]"
                  : "border-border-soft bg-canvas",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    item.done
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-border-soft text-text-muted",
                  )}
                >
                  {item.done ? (
                    <Check className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Icon className="h-3 w-3" aria-hidden="true" />
                  )}
                </span>
                <p className="truncate text-xs font-semibold text-text-strong">
                  {item.label}
                </p>
              </div>
              <p className="mt-1 break-words text-[11px] leading-relaxed text-text-soft">
                {item.detail}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function PrimaryLaunchActionPanel({
  state,
  action,
}: {
  state: TradingLaunchState;
  action: React.ReactNode;
}) {
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest sm:p-5",
        state.statusTone === "ready"
          ? "border-accent/30 bg-accent/[0.06]"
          : state.statusTone === "blocked"
            ? "border-warning/30 bg-warning/[0.08]"
            : "border-border-soft bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft">
            {state.modeLabel}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-text-strong">
            {state.complete ? "Practice is ready" : "Next action"}
          </h2>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            state.statusTone === "ready"
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : state.statusTone === "blocked"
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-border-soft bg-canvas text-text-soft",
          )}
        >
          {state.completedSteps} of {state.totalSteps}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-soft border border-border-soft bg-canvas p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-strong">
            {state.statusLabel}
          </p>
          {state.currentStep ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-soft">
              {state.currentStep.description}
            </p>
          ) : null}
        </div>
        <div className="w-full shrink-0 sm:w-auto">{action}</div>
      </div>
    </section>
  );
}
export function LaunchStepRow({
  step,
  action,
}: {
  step: TradingLaunchStep;
  action: React.ReactNode;
}) {
  const StepIcon = launchStepIcon(step.id);
  return (
    <li
      className={clsx(
        "flex flex-wrap items-center gap-3 rounded-soft border px-3 py-3",
        step.status === "current"
          ? "border-accent/40 bg-accent/[0.06]"
          : "border-border-soft bg-canvas",
      )}
    >
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
          step.status === "done"
            ? "border-accent/30 bg-accent/10 text-accent"
            : step.status === "current"
              ? "border-accent bg-accent text-text-on-accent"
              : "border-border-soft text-text-muted",
        )}
      >
        {step.status === "done" ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <StepIcon className="h-4 w-4" aria-hidden="true" strokeWidth={1.9} />
        )}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-text-strong">{step.label}</p>
          <span className="rounded-full border border-border-soft px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
            {ownerLabel(step.owner)}
          </span>
          <details className="group relative">
            <summary
              className="inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-border-soft text-text-soft transition-colors hover:border-accent/40 hover:text-accent"
              aria-label={`Show details for ${step.label}`}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </summary>
            <p className="absolute left-0 z-20 mt-2 w-[min(18rem,70vw)] rounded-soft border border-border-soft bg-surface-raised p-3 text-xs leading-relaxed text-text-soft shadow-card-rest">
              {step.description}
            </p>
          </details>
        </div>
      </div>
      {step.status === "current" ? <div className="w-full sm:w-auto">{action}</div> : null}
      {step.status === "waiting" ? <Circle className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" /> : null}
    </li>
  );
}
export function launchStepIcon(id: TradingLaunchStep["id"]): LucideIcon {
  switch (id) {
    case "trader":
      return UserRound;
    case "plan":
      return FileCheck2;
    case "safety":
      return ShieldCheck;
    case "allowance":
      return SlidersHorizontal;
    case "disclosures":
      return Info;
    case "account":
      return WalletCards;
    case "funding":
      return TrendingUp;
    case "protected_connection":
      return PlugZap;
    case "automatic":
      return Zap;
    case "first_idea":
      return Lightbulb;
    case "first_trade":
      return Play;
  }
}
