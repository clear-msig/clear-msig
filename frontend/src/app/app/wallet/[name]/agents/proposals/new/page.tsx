"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BrainCircuit, Lock, Send } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  decryptAgentVaultPolicy,
  bindAgentProposalPolicyHash,
  buildAgentTradeClearSignV2,
  encryptAgentTradeProposal,
  evaluateAgentTradeProposal,
  findAgent,
  buildAgentTradeDecisionJournal,
  getAgentVaultPolicy,
  agentRiskSnapshot,
  listAgents,
  listAgentSessions,
  newAgentProposalId,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  syncAgentExecution,
  syncAgentProposal,
  type AgentPolicyEvaluation,
  type AgentProfile,
  type AgentProposalStatus,
  type AgentTradeProposal,
  type TradeOrderType,
  type TradeSide,
  type TradingVenue,
} from "@/lib/agents/client";
import { encryptStatus } from "@/lib/encrypt/client";
import { toDisplayName } from "@/lib/retail/walletNames";
import { Button } from "@/components/retail/Button";
import { FormField, NativeSelect, TextArea, TextInput } from "@/components/retail/FormField";

const VENUES: Array<{ value: TradingVenue; label: string }> = [
  { value: "mock_perps", label: "Built-in practice" },
  { value: "hyperliquid_testnet", label: "Connected practice" },
  { value: "bulktrade_mock", label: "Bulk practice" },
];

export default function NewAgentProposalPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
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
  const requestedAgentId = search.get("agent")?.trim() ?? "";
  const requestedVenue = venueFromSearch(search.get("venue"));

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
  const [technicalSummary, setTechnicalSummary] = useState("");
  const [fundamentalSummary, setFundamentalSummary] = useState("");
  const [newsSummary, setNewsSummary] = useState("");
  const [riskPlan, setRiskPlan] = useState("");
  const [preview, setPreview] = useState<AgentPolicyEvaluation | null>(null);

  useEffect(() => {
    const list = listAgents(name);
    setAgents(list);
    setAgentId((current) =>
      list.some((agent) => agent.id === requestedAgentId)
        ? requestedAgentId
        : current || list[0]?.id || "",
    );
    if (requestedVenue) setVenue(requestedVenue);
  }, [name, requestedAgentId, requestedVenue]);

  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;

  useEffect(() => {
    if (!selectedAgent) return;
    const now = Date.now();
    const activeSession =
      listAgentSessions(name).find(
        (session) =>
          session.agentId === selectedAgent.id &&
          session.status === "active" &&
          session.expiresAt > now,
      ) ?? null;
    const policy = getAgentVaultPolicy(name);
    const nextLeverage = activeSession?.maxLeverage ?? policy.maxLeverage;
    if (Number.isFinite(nextLeverage) && nextLeverage > 0) {
      setLeverage(String(nextLeverage));
    }
    if (activeSession?.maxNotionalUsd) {
      setNotionalUsd(activeSession.maxNotionalUsd);
    }
    if (activeSession?.allowedVenues?.[0]) {
      setVenue(activeSession.allowedVenues[0]);
    }
  }, [name, selectedAgent]);

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
    const proposalWithPolicy = bindAgentProposalPolicyHash(proposal, policy);
    const activeSession =
      listAgentSessions(name).find(
        (session) =>
          session.agentId === agent.id &&
          session.status === "active" &&
          session.expiresAt > now,
      ) ?? null;
    const evaluation = evaluateAgentTradeProposal({
      agent,
      proposal: proposalWithPolicy,
      policy,
      session: activeSession,
      risk: agentRiskSnapshot(name, agent.id),
      now,
    });
    return {
      proposal: {
        ...proposalWithPolicy,
        decisionJournal: buildAgentTradeDecisionJournal({
          agent,
          proposal: proposalWithPolicy,
          evaluation,
          technicalSummary,
          fundamentalSummary,
          newsSummary,
          riskPlan,
          now,
        }),
      },
      evaluation,
    };
  };

  const previewProposal = () => {
    startTransition(async () => {
      const draft = await buildDraft();
      if (!draft) {
        toast.error("Add a trader before trying an idea");
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
        toast.error("Add a trader before trying an idea");
        return;
      }
      const status = statusForDecision(draft.evaluation);
      const proposalBase: AgentTradeProposal = {
        ...draft.proposal,
        status,
        evaluationDecision: draft.evaluation.decision,
        policyViolations: draft.evaluation.violations,
        updatedAt: Date.now(),
      };
      const proposal: AgentTradeProposal = {
        ...proposalBase,
        clearSignV2: buildAgentTradeClearSignV2(proposalBase),
      };
      try {
        const encrypted = await encryptAgentTradeProposal(proposal);
        if (status === "approved") {
          const result = saveAgentProposalAndExecuteIfAllowed(encrypted);
          const synced = await syncAgentProposal(result.proposal);
          if (result.execution) {
            await syncAgentExecution(result.execution);
          }
          if (synced.ok) {
            toast.success(
              result.execution
                ? "Trade idea passed your rules and a practice trade opened"
                : "Trade idea fits the current budget",
            );
          } else {
            toast.info("Trade idea saved on this device for now", {
              details: synced.message,
            });
          }
        } else {
          const saved = saveAgentProposal(encrypted);
          const synced = await syncAgentProposal(saved);
          if (synced.ok) {
            toast.success(
              status === "blocked"
                ? "Trade idea saved, but stopped by your safety rules"
                : "Trade idea saved for your approval",
            );
          } else {
            toast.info("Trade idea saved on this device for now", {
              details: synced.message,
            });
          }
        }
        router.push(
          `/app/wallet/${encodeURIComponent(name)}/agents/start?agent=${encodeURIComponent(agentId)}&venue=${encodeURIComponent(venue)}`,
        );
      } catch (err) {
        toast.error("Could not save trade idea", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Decision Journal · {display}
        </p>
        <h1 className="font-display text-lg leading-tight text-text-strong md:text-display-xs">
          Try a trade idea
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-soft">
          Enter one idea and see whether it fits the trading style, max-loss rules,
          and current budget.
        </p>
      </header>

      <section className="rounded-card bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <BrainCircuit className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">
              Trade idea
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Submit one idea and ClearSig will record why it passed, needed
              approval, or stopped.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label="Trader">
            <NativeSelect
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.length === 0 ? (
                <option value="">No traders added</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Practice mode"
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
              label="Trade size"
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

          <FormField label="Why this trade?">
            <TextArea
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
              rows={4}
              placeholder="Why this idea should be considered."
            />
          </FormField>

          <fieldset className="grid gap-3 rounded-card bg-canvas p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold text-text-strong">
              Research notes
            </legend>
            <TextAreaField
              label="Technical read"
              value={technicalSummary}
              onChange={setTechnicalSummary}
              placeholder="Trend, support, breakout, momentum, funding, volume."
            />
            <TextAreaField
              label="Fundamental read"
              value={fundamentalSummary}
              onChange={setFundamentalSummary}
              placeholder="Protocol, launch, liquidity, earnings, treasury, token supply."
            />
            <TextAreaField
              label="News / macro context"
              value={newsSummary}
              onChange={setNewsSummary}
              placeholder="US macro, geopolitics, regulation, war risk, major headlines."
            />
            <TextAreaField
              label="Risk plan"
              value={riskPlan}
              onChange={setRiskPlan}
              placeholder="What can go wrong, invalidation, position sizing logic."
            />
          </fieldset>

          {preview ? <DecisionPreview preview={preview} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={previewProposal}
                variant="secondary"
                size="md"
              >
                Check safety
              </Button>
              <Button type="submit" disabled={pending} size="md">
                <Send size={13} aria-hidden="true" />
                {pending ? "Saving" : "Save idea"}
              </Button>
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
          ? "Stopped by your safety rules"
          : preview.decision === "allowed"
            ? "Fits the current budget"
            : "Ready for your approval"}
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

function venueFromSearch(value: string | null): TradingVenue | null {
  return value === "mock_perps" ||
    value === "hyperliquid_testnet" ||
    value === "bulktrade_mock"
    ? value
    : null;
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

function TextAreaField({
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
      <TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
      />
    </FormField>
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
    <FormField label={label}>
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
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
