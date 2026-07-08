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
  syncAgentProfile,
  type AgentStrategyProfile,
  type AgentTradingMode,
} from "@/lib/agents/client";
import { toDisplayName } from "@/lib/retail/walletNames";
import { Button } from "@/components/retail/Button";
import {
  FormField,
  TextArea as SharedTextArea,
  TextInput,
} from "@/components/retail/FormField";

const MODES: Array<{ value: AgentTradingMode; label: string; hint: string }> = [
  {
    value: "read_only",
    label: "Suggest ideas only",
    hint: "The trader can suggest ideas, but cannot open trades.",
  },
  {
    value: "paper",
    label: "Guarded trading",
    hint: "The trader can open trades inside your safety rules.",
  },
  {
    value: "bounded_live",
    label: "Real trading later",
    hint: "Reserved for real trading after stronger checks are ready.",
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
        "Only suggest a trade when the opportunity is clear and uses an allowed market.",
      );
      setExitRules(
        "Every idea must explain when to exit, when to stop the loss, and when to take profit.",
      );
      setRiskRules(
        "Stay within the chosen trade size, borrowing, open trade, rest time, and daily loss limits.",
      );
      setExecutionProtocol(
        "Suggest the trade first. Use practice trading only while a current budget is active.",
      );
      setKillSwitchRules(
        "Stop when all trading is paused, a safety rule fails, prices are out of date, or losses reach the chosen limit.",
      );
    }
    setLoaded(true);
  }, [agentId, name]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const agent = findAgent(name, agentId);
      if (!agent) {
        toast.error("Trader not found");
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
      const updated = {
        ...agent,
        strategy,
        updatedAt: Date.now(),
      };
      saveAgent(updated);
      const synced = await syncAgentProfile(updated);
      if (synced.ok) {
        toast.success("Trading style saved");
      } else {
        toast.info("Trading style saved on this device for now", {
          details: synced.message,
        });
      }
      router.push(
        `/app/wallet/${encodedWallet}/agents/start?agent=${encodeURIComponent(agentId)}`,
      );
    });
  };

  if (!loaded) {
    return <div className="text-sm text-text-soft">Loading trading style...</div>;
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
            Trading style · {display}
          </p>
          <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
            {agentName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
            Set what this trader may trade, when it may act, and when it must stop.
          </p>
        </div>
      </header>

      <section className="rounded-card bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">Trading style</p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Your safety rules always win if this plan asks for too much.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-text-soft">What may it do?</legend>
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
            label="Simple summary"
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
          <TextArea label="When may it enter?" value={entryRules} onChange={setEntryRules} />
          <TextArea label="When must it exit?" value={exitRules} onChange={setExitRules} />
          <TextArea label="How should it stay safe?" value={riskRules} onChange={setRiskRules} />
          <TextArea
            label="How should it place a trade?"
            value={executionProtocol}
            onChange={setExecutionProtocol}
          />
          <TextArea
            label="When must it stop completely?"
            value={killSwitchRules}
            onChange={setKillSwitchRules}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <Button
              type="submit"
              disabled={pending}
            >
              <Save size={13} aria-hidden="true" />
              {pending ? "Saving" : "Save trading plan"}
            </Button>
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
    <FormField label={label}>
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </FormField>
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
    <FormField label={label}>
      <SharedTextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
      />
    </FormField>
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
