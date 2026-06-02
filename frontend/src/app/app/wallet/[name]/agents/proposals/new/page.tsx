"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, BrainCircuit, Lock, Send } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  decryptAgentVaultPolicy,
  encryptAgentTradeProposal,
  evaluateAgentTradeProposal,
  findAgent,
  getAgentVaultPolicy,
  agentRiskSnapshot,
  listAgents,
  listAgentSessions,
  newAgentProposalId,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  type AgentPolicyEvaluation,
  type AgentProfile,
  type AgentProposalStatus,
  type AgentTradeProposal,
  type TradeOrderType,
  type TradeSide,
  type TradingVenue,
} from "@/lib/agents";
import { encryptStatus } from "@/lib/encrypt/client";
import { toDisplayName } from "@/lib/retail/walletNames";

const VENUES: Array<{ value: TradingVenue; label: string }> = [
  { value: "mock_perps", label: "Paper Perps" },
  { value: "hyperliquid_testnet", label: "Hyperliquid Testnet" },
  { value: "bulktrade_mock", label: "Bulk Paper" },
];

export default function NewAgentProposalPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const toast = useToast();
  const encrypt = encryptStatus();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.name]);
  const display = toDisplayName(name);

  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState("");
  const [venue, setVenue] = useState<TradingVenue>("mock_perps");
  const [market, setMarket] = useState("BTC-PERP");
  const [side, setSide] = useState<TradeSide>("long");
  const [orderType, setOrderType] = useState<TradeOrderType>("market");
  const [notionalUsd, setNotionalUsd] = useState("250");
  const [leverage, setLeverage] = useState("1");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [confidence, setConfidence] = useState("70");
  const [expiresMinutes, setExpiresMinutes] = useState("15");
  const [thesis, setThesis] = useState("");
  const [preview, setPreview] = useState<AgentPolicyEvaluation | null>(null);

  useEffect(() => {
    const list = listAgents(name);
    setAgents(list);
    setAgentId((current) => current || list[0]?.id || "");
  }, [name]);

  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;

  const buildDraft = async (): Promise<{
    proposal: AgentTradeProposal;
    evaluation: AgentPolicyEvaluation;
  } | null> => {
    const agent = selectedAgent ?? (agentId ? findAgent(name, agentId) : null);
    if (!agent) return null;
    const now = Date.now();
    const expiresAt =
      now + Math.max(1, Number(expiresMinutes) || 15) * 60 * 1000;
    const proposal: AgentTradeProposal = {
      id: newAgentProposalId(),
      walletName: name,
      agentId: agent.id,
      venue,
      market: market.trim().toUpperCase(),
      side,
      orderType,
      notionalUsd: notionalUsd.trim(),
      leverage: Number(leverage),
      entryPrice: cleanOptional(entryPrice),
      stopLossPrice: cleanOptional(stopLossPrice),
      takeProfitPrice: cleanOptional(takeProfitPrice),
      thesis: thesis.trim() || undefined,
      confidence: clamp(Number(confidence), 0, 100),
      expiresAt,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const policy = await decryptAgentVaultPolicy(getAgentVaultPolicy(name));
    const activeSession =
      listAgentSessions(name).find(
        (session) =>
          session.agentId === agent.id &&
          session.status === "active" &&
          session.expiresAt > now,
      ) ?? null;
    const evaluation = evaluateAgentTradeProposal({
      agent,
      proposal,
      policy,
      session: activeSession,
      risk: agentRiskSnapshot(name, agent.id),
      now,
    });
    return { proposal, evaluation };
  };

  const previewProposal = () => {
    startTransition(async () => {
      const draft = await buildDraft();
      if (!draft) {
        toast.error("Register an agent before saving signals");
        return;
      }
      setPreview(draft.evaluation);
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const draft = await buildDraft();
      if (!draft) {
        toast.error("Register an agent before saving signals");
        return;
      }
      const status = statusForDecision(draft.evaluation);
      const proposal: AgentTradeProposal = {
        ...draft.proposal,
        status,
        evaluationDecision: draft.evaluation.decision,
        policyViolations: draft.evaluation.violations,
        updatedAt: Date.now(),
      };
      try {
        const encrypted = await encryptAgentTradeProposal(proposal);
        if (status === "approved") {
          const result = saveAgentProposalAndExecuteIfAllowed(encrypted);
          toast.success(
            result.execution
              ? "Trade signal passed risk and paper trade opened"
              : "Trade signal approved by active session",
          );
        } else {
          saveAgentProposal(encrypted);
          toast.success(
            status === "blocked"
              ? "Trade signal saved as blocked"
              : "Trade signal saved for approval",
          );
        }
        router.push(`/app/wallet/${encodeURIComponent(name)}/agents`);
      } catch (err) {
        toast.error("Could not save trade signal", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Agent Trading · {display}
        </p>
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          New trade signal
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-soft">
          Agents submit trade signals. ClearSig checks risk limits before a
          human approves or an active trading session can act.
        </p>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <BrainCircuit className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">
              Trade signal
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              This saves a signal only. Live venue execution stays off until
              you connect a real venue.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">Agent</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className={INPUT_CLASS}
            >
              {agents.length === 0 ? (
                <option value="">No agents registered</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Venue"
              value={venue}
              onChange={(value) => setVenue(value as TradingVenue)}
              options={VENUES}
            />
            <TextField label="Market" value={market} onChange={setMarket} />
            <SelectField
              label="Side"
              value={side}
              onChange={(value) => setSide(value as TradeSide)}
              options={[
                { value: "long", label: "Long" },
                { value: "short", label: "Short" },
              ]}
            />
            <SelectField
              label="Order type"
              value={orderType}
              onChange={(value) => setOrderType(value as TradeOrderType)}
              options={[
                { value: "market", label: "Market" },
                { value: "limit", label: "Limit" },
              ]}
            />
            <TextField
              label="Notional size"
              value={notionalUsd}
              onChange={setNotionalUsd}
            />
            <TextField label="Leverage" value={leverage} onChange={setLeverage} />
            <TextField
              label="Entry price"
              value={entryPrice}
              onChange={setEntryPrice}
              placeholder="Optional"
            />
            <TextField
              label="Stop loss"
              value={stopLossPrice}
              onChange={setStopLossPrice}
              placeholder="Required by default"
            />
            <TextField
              label="Take profit"
              value={takeProfitPrice}
              onChange={setTakeProfitPrice}
              placeholder="Optional"
            />
            <TextField
              label="Confidence"
              value={confidence}
              onChange={setConfidence}
            />
            <TextField
              label="Expires in minutes"
              value={expiresMinutes}
              onChange={setExpiresMinutes}
            />
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">Thesis</span>
            <textarea
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
              rows={4}
              placeholder="Why this signal should be considered."
              className={clsx(INPUT_CLASS, "resize-none leading-relaxed")}
            />
          </label>

          {preview ? <DecisionPreview preview={preview} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={previewProposal}
                className={SECONDARY_BUTTON_CLASS}
              >
                Check risk
              </button>
              <button type="submit" disabled={pending} className={BUTTON_CLASS}>
                <Send size={13} aria-hidden="true" />
                {pending ? "Saving" : "Save signal"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function DecisionPreview({ preview }: { preview: AgentPolicyEvaluation }) {
  const blocked = preview.decision === "blocked";
  return (
    <div
      className={clsx(
        "rounded-soft border p-3 text-xs",
        blocked
          ? "border-rose-500/25 bg-rose-500/[0.08] text-rose-200"
          : "border-accent/25 bg-accent/[0.08] text-text-strong",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {blocked
          ? "Blocked by risk limits"
          : preview.decision === "allowed"
            ? "Allowed by active session"
            : "Valid, needs approval"}
      </div>
      {preview.violations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-soft">
          {preview.violations.map((violation) => (
            <li key={`${violation.code}:${violation.message}`}>
              {violation.message}
            </li>
          ))}
        </ul>
      ) : null}
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

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-soft">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function statusForDecision(decision: AgentPolicyEvaluation): AgentProposalStatus {
  if (decision.decision === "blocked") return "blocked";
  if (decision.decision === "allowed") return "approved";
  return "needs_approval";
}

function cleanOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const INPUT_CLASS = clsx(
  "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong",
  "placeholder:text-text-muted",
  "transition-[border-color,box-shadow] duration-base ease-out-soft",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
);

const BUTTON_CLASS = clsx(
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest",
  "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
  "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

const SECONDARY_BUTTON_CLASS = clsx(
  "inline-flex min-h-tap items-center justify-center rounded-soft border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-strong",
  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
  "disabled:cursor-not-allowed disabled:opacity-60",
);
