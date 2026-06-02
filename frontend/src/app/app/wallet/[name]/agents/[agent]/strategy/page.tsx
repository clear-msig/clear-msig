"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, Lock, Save, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  findAgent,
  saveAgent,
  type AgentStrategyProfile,
  type AgentTradingMode,
} from "@/lib/agents";
import { toDisplayName } from "@/lib/retail/walletNames";

const MODES: Array<{ value: AgentTradingMode; label: string; hint: string }> = [
  {
    value: "read_only",
    label: "Read-only",
    hint: "Agent can analyze markets and submit signals only.",
  },
  {
    value: "paper",
    label: "Paper trading",
    hint: "Agent can open simulated positions inside risk limits.",
  },
  {
    value: "bounded_live",
    label: "Bounded live",
    hint: "Future mode for real venue execution after hard controls are ready.",
  },
];

export default function AgentStrategyPage() {
  const params = useParams<{ name: string; agent: string }>();
  const router = useRouter();
  const toast = useToast();
  const encrypt = encryptStatus();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const agentId = useMemo(() => decodeParam(params?.agent), [params?.agent]);
  const encodedWallet = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [agentName, setAgentName] = useState("Trading agent");
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<AgentTradingMode>("paper");
  const [summary, setSummary] = useState("");
  const [allowedMarkets, setAllowedMarkets] = useState("BTC-PERP, ETH-PERP, SOL-PERP");
  const [entryRules, setEntryRules] = useState("");
  const [exitRules, setExitRules] = useState("");
  const [riskRules, setRiskRules] = useState("");
  const [executionProtocol, setExecutionProtocol] = useState("");
  const [killSwitchRules, setKillSwitchRules] = useState("");

  useEffect(() => {
    const agent = findAgent(name, agentId);
    if (!agent) {
      setLoaded(true);
      return;
    }
    setAgentName(agent.name);
    if (agent.strategy) {
      setMode(agent.strategy.mode);
      setSummary(agent.strategy.summary ?? "");
      setAllowedMarkets(agent.strategy.allowedMarkets.join(", "));
      setEntryRules(agent.strategy.entryRules);
      setExitRules(agent.strategy.exitRules);
      setRiskRules(agent.strategy.riskRules);
      setExecutionProtocol(agent.strategy.executionProtocol);
      setKillSwitchRules(agent.strategy.killSwitchRules);
    } else {
      setEntryRules(
        "Only submit signals when the setup is clear, liquid, and matches allowed markets.",
      );
      setExitRules(
        "Every signal must include invalidation, stop loss, and take-profit logic when available.",
      );
      setRiskRules(
        "Respect max notional, max leverage, max open positions, cooldowns, and daily loss controls.",
      );
      setExecutionProtocol(
        "Submit structured trade signals first. Use paper trading until the vault grants a bounded session.",
      );
      setKillSwitchRules(
        "Stop trading when emergency pause is enabled, risk limits fail, venue data is stale, or realized losses exceed the vault cap.",
      );
    }
    setLoaded(true);
  }, [agentId, name]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(() => {
      const agent = findAgent(name, agentId);
      if (!agent) {
        toast.error("Trading agent not found");
        return;
      }
      const strategy: AgentStrategyProfile = {
        mode,
        summary: summary.trim() || undefined,
        allowedMarkets: allowedMarkets
          .split(",")
          .map((market) => market.trim().toUpperCase())
          .filter(Boolean),
        entryRules: entryRules.trim(),
        exitRules: exitRules.trim(),
        riskRules: riskRules.trim(),
        executionProtocol: executionProtocol.trim(),
        killSwitchRules: killSwitchRules.trim(),
        updatedAt: Date.now(),
      };
      saveAgent({
        ...agent,
        strategy,
        updatedAt: Date.now(),
      });
      toast.success("Strategy playbook saved");
      router.push(`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agentId)}`);
    });
  };

  if (!loaded) {
    return <div className="text-sm text-text-soft">Loading strategy...</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agentId)}`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {agentName}
        </Link>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Strategy Playbook · {display}
          </p>
          <h1 className="hidden md:block mt-1 font-display text-display-xs leading-tight text-text-strong">
            {agentName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
            Define how this trading agent finds signals, manages exits, follows risk limits, and stops when conditions break.
          </p>
        </div>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">Strategy and risk gate</p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              This is the agent’s operating playbook. Risk limits still override it.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-text-soft">Operating mode</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((option) => (
                <label
                  key={option.value}
                  className={clsx(
                    "flex min-h-[5.25rem] cursor-pointer flex-col gap-1 rounded-soft border bg-canvas p-3",
                    mode === option.value ? "border-accent/70" : "border-border-soft",
                  )}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-text-strong">
                    <input
                      type="radio"
                      checked={mode === option.value}
                      onChange={() => setMode(option.value)}
                      className="h-4 w-4 accent-accent"
                    />
                    {option.label}
                  </span>
                  <span className="text-[11px] leading-relaxed text-text-soft">
                    {option.hint}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <TextArea
            label="Strategy summary"
            value={summary}
            onChange={setSummary}
            placeholder="Example: BTC/ETH momentum scalper using clean breakouts and fast invalidation."
            rows={3}
          />
          <TextField
            label="Allowed markets"
            value={allowedMarkets}
            onChange={setAllowedMarkets}
            placeholder="BTC-PERP, ETH-PERP, SOL-PERP"
          />
          <TextArea label="Entry rules" value={entryRules} onChange={setEntryRules} />
          <TextArea label="Exit rules" value={exitRules} onChange={setExitRules} />
          <TextArea label="Risk rules" value={riskRules} onChange={setRiskRules} />
          <TextArea
            label="Execution protocol"
            value={executionProtocol}
            onChange={setExecutionProtocol}
          />
          <TextArea
            label="Kill switch rules"
            value={killSwitchRules}
            onChange={setKillSwitchRules}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-[background-color,box-shadow,transform] duration-base ease-out-soft hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={13} aria-hidden="true" />
              {pending ? "Saving" : "Save strategy"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-soft">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-soft">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={clsx(INPUT_CLASS, "resize-none leading-relaxed")}
      />
    </label>
  );
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const INPUT_CLASS = clsx(
  "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong",
  "placeholder:text-text-muted",
  "transition-[border-color,box-shadow] duration-base ease-out-soft",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
);
