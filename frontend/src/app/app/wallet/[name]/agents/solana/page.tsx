"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  bindAgentVaultPolicyHash,
  buildAgentSolanaDelegationSummary,
  getAgentSolanaDelegation,
  getAgentVaultPolicy,
  listAgents,
  saveAgentSolanaDelegation,
  updateAgentSolanaDelegationStatus,
  type AgentProfile,
  type AgentSolanaDelegationRecord,
  type TradingVenue,
} from "@/lib/agents";
import { toDisplayName } from "@/lib/retail/walletNames";

const VENUES: TradingVenue[] = ["mock_perps", "hyperliquid_testnet", "bulktrade_mock"];

export default function SolanaDelegationPage() {
  const params = useParams<{ name: string }>();
  const toast = useToast();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState("");
  const policy = useMemo(
    () => bindAgentVaultPolicyHash(getAgentVaultPolicy(name)),
    [name],
  );
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const [delegation, setDelegation] = useState<AgentSolanaDelegationRecord | null>(null);
  const [signerDraft, setSignerDraft] = useState("");
  const [notionalDraft, setNotionalDraft] = useState(policy.maxNotionalUsd);
  const [leverageDraft, setLeverageDraft] = useState(String(policy.maxLeverage));
  const [openDraft, setOpenDraft] = useState(String(policy.maxOpenPositionsPerAgent));
  const [hoursDraft, setHoursDraft] = useState(String(policy.maxSessionHours));
  const [marketsDraft, setMarketsDraft] = useState(policy.allowedMarkets.join(", "));
  const [venuesDraft, setVenuesDraft] = useState<TradingVenue[]>(policy.allowedVenues);

  useEffect(() => {
    const nextAgents = listAgents(name);
    setAgents(nextAgents);
    setAgentId((current) => current || nextAgents[0]?.id || "");
  }, [name]);

  useEffect(() => {
    if (!agentId) {
      setDelegation(null);
      setSignerDraft("");
      return;
    }
    const current = getAgentSolanaDelegation(name, agentId);
    setDelegation(current);
    setSignerDraft(current.agentSignerPubkey);
    setNotionalDraft(current.maxNotionalUsd || policy.maxNotionalUsd);
    setLeverageDraft(String(current.maxLeverage || policy.maxLeverage));
    setOpenDraft(String(current.maxOpenPositions || policy.maxOpenPositionsPerAgent));
    setMarketsDraft(
      (current.allowedMarkets.length ? current.allowedMarkets : policy.allowedMarkets).join(
        ", ",
      ),
    );
    setVenuesDraft(
      current.allowedVenues.length ? current.allowedVenues : policy.allowedVenues,
    );
    const hoursLeft =
      current.expiresAt > Date.now()
        ? Math.max(1, Math.ceil((current.expiresAt - Date.now()) / 60 / 60_000))
        : policy.maxSessionHours;
    setHoursDraft(String(hoursLeft));
  }, [agentId, name, policy]);

  const summary = delegation
    ? buildAgentSolanaDelegationSummary({
        delegation,
        policy,
        agent: selectedAgent,
      })
    : null;

  const save = () => {
    if (!selectedAgent) return;
    try {
      const now = Date.now();
      const saved = saveAgentSolanaDelegation({
        walletName: name,
        agentId: selectedAgent.id,
        agentSignerPubkey: signerDraft,
        policy,
        allowedMarkets: parseMarkets(marketsDraft),
        allowedVenues: venuesDraft,
        maxNotionalUsd: notionalDraft,
        maxLeverage: Number(leverageDraft),
        maxOpenPositions: Number(openDraft),
        expiresAt: now + Math.max(1, Number(hoursDraft)) * 60 * 60_000,
        now,
      });
      setDelegation(saved);
      toast.success("Solana agent delegation saved");
    } catch (error) {
      toast.error("Could not save Solana delegation", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const setStatus = (status: "active" | "rotation_required" | "revoked") => {
    if (!selectedAgent) return;
    try {
      const updated = updateAgentSolanaDelegationStatus({
        walletName: name,
        agentId: selectedAgent.id,
        status,
        reason:
          status === "rotation_required"
            ? "Rotate this Solana agent signer before further beta trading."
            : undefined,
      });
      setDelegation(updated);
      toast.success(`Delegation ${statusLabel(status).toLowerCase()}`);
    } catch (error) {
      toast.error("Could not update delegation status", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Solana Delegation · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Solana agent delegation
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-soft">
              Record a policy-bound agent signer, scope, expiry, and lifecycle
              state. This is the Solana-style authority model that can later map
              to on-chain delegation accounts.
            </p>
          </div>
          <span
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              summary?.status === "ready"
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : summary?.status === "blocked"
                  ? "border-danger/30 bg-danger/[0.06] text-danger"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
            )}
          >
            {summary?.headline ?? "Choose an agent"}
          </span>
        </div>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              Standard model
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              User funds stay in the vault. The agent signer is only an
              authorized identity for bounded intents. ClearSig binds it to the
              current safety check hash, expiry, allowed markets, max size, and
              revocation status before any execution path can trust it.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <MiniMetric label="Authority" value="Vault safety" />
          <MiniMetric label="Signer" value="Agent public key" />
          <MiniMetric label="Binding" value={policy.policyHash ? `${policy.policyHash.slice(0, 12)}...` : "Missing"} />
          <MiniMetric label="Lifecycle" value={delegation ? statusLabel(delegation.status) : "Not started"} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-text-strong">Agent</span>
              <select
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                className={INPUT_CLASS}
              >
                {agents.length === 0 ? <option value="">No agents yet</option> : null}
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-text-strong">
                Agent signer public key
              </span>
              <input
                value={signerDraft}
                onChange={(event) => setSignerDraft(event.target.value)}
                placeholder="Solana public key"
                className={`${INPUT_CLASS} font-mono`}
                spellCheck={false}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-text-strong">Max size</span>
                <input
                  value={notionalDraft}
                  onChange={(event) => setNotionalDraft(event.target.value)}
                  inputMode="decimal"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-text-strong">Max leverage</span>
                <input
                  value={leverageDraft}
                  onChange={(event) => setLeverageDraft(event.target.value)}
                  inputMode="numeric"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-text-strong">Hours</span>
                <input
                  value={hoursDraft}
                  onChange={(event) => setHoursDraft(event.target.value)}
                  inputMode="numeric"
                  className={INPUT_CLASS}
                />
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-text-strong">Open trades</span>
              <input
                value={openDraft}
                onChange={(event) => setOpenDraft(event.target.value)}
                inputMode="numeric"
                className={INPUT_CLASS}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-text-strong">Markets</span>
              <input
                value={marketsDraft}
                onChange={(event) => setMarketsDraft(event.target.value)}
                placeholder="BTC-PERP, ETH-PERP"
                className={INPUT_CLASS}
              />
            </label>
            <div className="grid gap-2">
              <span className="text-xs font-semibold text-text-strong">Allowed venues</span>
              <div className="flex flex-wrap gap-2">
                {VENUES.map((venue) => {
                  const active = venuesDraft.includes(venue);
                  return (
                    <button
                      key={venue}
                      type="button"
                      onClick={() => setVenuesDraft((current) => toggleVenue(current, venue))}
                      className={clsx(
                        "inline-flex min-h-9 items-center gap-1.5 rounded-soft border px-3 py-2 text-xs font-medium transition-colors",
                        active
                          ? "border-accent/40 bg-accent/[0.08] text-accent"
                          : "border-border-soft bg-canvas text-text-soft hover:border-accent/50 hover:text-accent",
                      )}
                    >
                      {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      {venueLabel(venue)}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              disabled={!selectedAgent}
              onClick={save}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save delegation
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {(summary?.steps ?? []).map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {!summary ? (
            <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-5 text-sm text-text-soft">
              Choose an agent to create a Solana delegation.
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              Delegation lifecycle
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              Use these controls when the signer is compromised, stale, or no
              longer authorized. On-chain revocation will later map this state
              to a Solana authority account.
            </p>
          </div>
          <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
            {delegation ? statusLabel(delegation.status) : "Not started"}
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <MiniMetric label="Approved" value={delegation?.approvedAt ? formatDate(delegation.approvedAt) : "-"} />
          <MiniMetric label="Expires" value={delegation?.expiresAt ? formatDate(delegation.expiresAt) : "-"} />
          <MiniMetric label="Revoked" value={delegation?.revokedAt ? formatDate(delegation.revokedAt) : "-"} />
          <MiniMetric label="Rotation" value={delegation?.rotationReason ?? "None"} />
        </div>
        <div className="mt-4 rounded-soft border border-border-soft bg-canvas p-3">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-text-soft" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-strong">Policy receipt</p>
              <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-text-soft">
                signer={delegation?.agentSignerPubkey || "not-set"} ·
                policy={delegation?.policyHash || policy.policyHash || "missing"} ·
                status={delegation ? delegation.status : "not_started"}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!delegation?.agentSignerPubkey || delegation.status === "active"}
            onClick={() => setStatus("active")}
            className={CONTROL_CLASS}
          >
            Mark active
          </button>
          <button
            type="button"
            disabled={!delegation?.agentSignerPubkey || delegation.status === "rotation_required"}
            onClick={() => setStatus("rotation_required")}
            className={WARNING_CLASS}
          >
            Require rotation
          </button>
          <button
            type="button"
            disabled={!delegation?.agentSignerPubkey || delegation.status === "revoked"}
            onClick={() => setStatus("revoked")}
            className={DANGER_CLASS}
          >
            Mark revoked
          </button>
        </div>
      </section>
    </div>
  );
}

function StepRow({
  step,
}: {
  step: NonNullable<ReturnType<typeof buildAgentSolanaDelegationSummary>>["steps"][number];
}) {
  return (
    <div
      className={clsx(
        "rounded-card border p-3",
        step.status === "ready"
          ? "border-accent/30 bg-accent/[0.07]"
          : step.status === "blocked"
            ? "border-danger/30 bg-danger/[0.06]"
            : "border-border-soft bg-canvas",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            step.status === "ready"
              ? "border-accent/30 text-accent"
              : step.status === "blocked"
                ? "border-danger/30 text-danger"
                : "border-border-soft text-text-muted",
          )}
        >
          {step.status === "ready" ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : step.status === "blocked" ? (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-strong">{step.label}</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-text-soft">
            {step.message}
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-semibold text-text-strong">
        {value}
      </p>
    </div>
  );
}

function decodeParam(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: AgentSolanaDelegationRecord["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "rotation_required":
      return "Rotation required";
    case "revoked":
      return "Revoked";
    case "not_started":
      return "Not started";
  }
}

function parseMarkets(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function toggleVenue(current: TradingVenue[], venue: TradingVenue): TradingVenue[] {
  return current.includes(venue)
    ? current.filter((item) => item !== venue)
    : [...current, venue];
}

function venueLabel(venue: TradingVenue): string {
  switch (venue) {
    case "mock_perps":
      return "Internal sandbox";
    case "hyperliquid_testnet":
      return "Hyperliquid testnet";
    case "bulktrade_mock":
      return "Bulk sandbox";
  }
}

const INPUT_CLASS =
  "min-h-10 w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/25";

const CONTROL_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60";

const WARNING_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-warning/30 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/[0.08] disabled:cursor-not-allowed disabled:opacity-60";

const DANGER_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-danger/30 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/[0.06] disabled:cursor-not-allowed disabled:opacity-60";
