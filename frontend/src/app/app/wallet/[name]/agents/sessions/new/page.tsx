"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Clock, Lock, Play, Save } from "lucide-react";
import { OwnerApprovalDialog } from "@/components/agents/OwnerApprovalDialog";
import { useToast } from "@/components/ui/Toast";
import {
  boundAgentSessionToPolicy,
  createBrowserOwnerApproval,
  decryptAgentVaultPolicy,
  agentAllocationLimits,
  agentAllocationTierById,
  agentSessionSetupIssue,
  getAgentVaultPolicy,
  isAgentSessionCurrent,
  listAgents,
  listAgentSessions,
  newAgentSessionId,
  ownerApprovalSignableText,
  saveAgentOwnerApproval,
  saveAgentSession,
  syncAgentOwnerApproval,
  syncAgentSession,
  type AgentOwnerApprovalInput,
  type AgentProfile,
  type AgentSessionGrant,
  type AgentVaultPolicy,
  type TradingVenue,
} from "@/lib/agents";
import { encryptStatus } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { toDisplayName } from "@/lib/retail/walletNames";

const VENUES: Array<{ value: TradingVenue; label: string }> = [
  { value: "mock_perps", label: "Built-in practice" },
  { value: "hyperliquid_testnet", label: "Connected practice" },
  { value: "bulktrade_mock", label: "Bulk practice" },
];

export default function NewAgentSessionPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const encrypt = encryptStatus();
  const { canSign, signBytes } = useSignWithWallet();
  const name = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.name]);
  const display = toDisplayName(name);
  const encoded = encodeURIComponent(name);
  const requestedAgentId = search.get("agent")?.trim() ?? "";
  const requestedTier = agentAllocationTierById(search.get("allocationTier"));
  const requestedVenue = venueFromSearch(search.get("venue"));
  const requestedAmount = positiveQueryNumber(search.get("amount"));
  const requestedLeverage = positiveQueryNumber(search.get("leverage"));

  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [policy, setPolicy] = useState<AgentVaultPolicy | null>(null);
  const [sessions, setSessions] = useState<AgentSessionGrant[]>([]);
  const [agentId, setAgentId] = useState("");
  const [allowedVenues, setAllowedVenues] = useState<TradingVenue[]>(["mock_perps"]);
  const [allowedMarkets, setAllowedMarkets] = useState("BTC-PERP, ETH-PERP");
  const [maxNotionalUsd, setMaxNotionalUsd] = useState("250");
  const [maxLeverage, setMaxLeverage] = useState("1");
  const [maxOpenPositions, setMaxOpenPositions] = useState("1");
  const [durationHours, setDurationHours] = useState("4");
  const [approvalRequest, setApprovalRequest] = useState<AgentOwnerApprovalInput | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingGrant = useRef<{
    grant: AgentSessionGrant;
    redirectVenue: TradingVenue;
  } | null>(null);
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const setupIssue = selectedAgent ? agentSessionSetupIssue(selectedAgent) : null;
  const activeAllowance =
    selectedAgent && policy
      ? sessions.find(
          (session) =>
            session.agentId === selectedAgent.id &&
            isAgentSessionCurrent(session, policy),
        )
      : null;
  const activeAllowanceVenue =
    activeAllowance?.allowedVenues?.[0] ??
    requestedVenue ??
    policy?.allowedVenues[0] ??
    "mock_perps";

  useEffect(() => {
    let alive = true;
    const list = listAgents(name).filter((agent) => agent.status === "active");
    setAgents(list);
    setSessions(listAgentSessions(name));
    setAgentId((current) =>
      list.some((agent) => agent.id === requestedAgentId)
        ? requestedAgentId
        : current || list[0]?.id || "",
    );
    decryptAgentVaultPolicy(getAgentVaultPolicy(name)).then((decrypted) => {
      if (!alive) return;
      setPolicy(decrypted);
      const allocation = requestedTier
        ? agentAllocationLimits(requestedTier, decrypted)
        : null;
      setAllowedVenues(
        requestedVenue
          ? [requestedVenue]
          : allocation?.allowedVenues.length
          ? allocation.allowedVenues
          : decrypted.allowedVenues.length
            ? decrypted.allowedVenues
            : ["mock_perps"],
      );
      setAllowedMarkets(
        allocation?.allowedMarkets.length
          ? allocation.allowedMarkets.join(", ")
          : decrypted.allowedMarkets.length
            ? decrypted.allowedMarkets.join(", ")
            : "BTC-PERP, ETH-PERP",
      );
      setMaxNotionalUsd(
        requestedAmount ??
          allocation?.maxNotionalUsd ??
          decrypted.maxNotionalUsd ??
          "250",
      );
      setMaxLeverage(
        requestedLeverage ??
          String(allocation?.maxLeverage ?? decrypted.maxLeverage ?? 1),
      );
      setMaxOpenPositions(
        String(
          allocation?.maxOpenPositions ?? decrypted.maxOpenPositionsPerAgent ?? 1,
        ),
      );
      setDurationHours(
        String(
          allocation?.sessionHours ?? Math.min(decrypted.maxSessionHours || 4, 4),
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, [
    name,
    requestedAgentId,
    requestedAmount,
    requestedLeverage,
    requestedTier,
    requestedVenue,
  ]);

  const cancelOwnerApproval = useCallback(() => {
    pendingGrant.current = null;
    setApprovalRequest(null);
  }, []);

  const approveOwnerRequest = useCallback(async () => {
    const pending = pendingGrant.current;
    if (!approvalRequest || !pending) return;
    setSaving(true);
    try {
      const approval = await createBrowserOwnerApproval(approvalRequest);
      if (canSign) {
        const createdAt = Date.now();
        const message = ownerApprovalSignableText(approvalRequest, createdAt);
        const signed = await signBytes(new TextEncoder().encode(message));
        const signedApproval = await createBrowserOwnerApproval({
          ...approvalRequest,
          now: createdAt,
          approvedBy: signed.signer_pubkey,
          signature: signed.signature,
        });
        saveAgentOwnerApproval(signedApproval);
        const approvalSynced = await syncAgentOwnerApproval(signedApproval);
        if (!approvalSynced.ok) {
          toast.info("Approval saved on this device for now", {
            details: approvalSynced.message,
          });
        }
      } else {
        saveAgentOwnerApproval(approval);
        const approvalSynced = await syncAgentOwnerApproval(approval);
        if (!approvalSynced.ok) {
          toast.info("Approval saved on this device for now", {
            details: approvalSynced.message,
          });
        }
      }
      const saved = saveAgentSession(pending.grant);
      setSessions(listAgentSessions(name));
      const synced = await syncAgentSession(saved);
      if (synced.ok) {
        toast.success("Practice budget is ready");
      } else {
        toast.info("Practice budget saved on this device for now", {
          details: synced.message,
        });
      }
      pendingGrant.current = null;
      setApprovalRequest(null);
      router.push(
        `/app/wallet/${encoded}/agents/start?agent=${encodeURIComponent(saved.agentId)}&venue=${encodeURIComponent(pending.redirectVenue)}`,
      );
    } catch (error) {
      toast.error("Could not approve budget", {
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }, [approvalRequest, canSign, encoded, name, router, signBytes, toast]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!policy) {
      toast.info("Rules are still loading");
      return;
    }
    if (!agentId) {
      toast.error("Choose an active trader before setting a budget");
      return;
    }
    if (setupIssue) {
      toast.error("Review the trading style before setting a budget", {
        details: setupIssue,
      });
      return;
    }
    const now = Date.now();
    const hours = clampPositive(Number(durationHours), 1);
    const maxHours = policy?.maxSessionHours && policy.maxSessionHours > 0
      ? policy.maxSessionHours
      : hours;
    const boundedHours = Math.min(hours, maxHours);
    const requestedGrant: AgentSessionGrant = {
      id: newAgentSessionId(),
      walletName: name,
      agentId,
      status: "active",
      startsAt: now,
      expiresAt: now + boundedHours * 60 * 60 * 1000,
      allowedVenues,
      allowedMarkets: allowedMarkets
        .split(",")
        .map((market) => market.trim().toUpperCase())
        .filter(Boolean),
      maxNotionalUsd: normalizePositiveText(maxNotionalUsd, "250"),
      maxLeverage: clampPositive(Number(maxLeverage), 1),
      maxOpenPositions: Math.floor(clampPositive(Number(maxOpenPositions), 1)),
      allocationTierId: requestedTier?.id,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const grant = boundAgentSessionToPolicy(
      requestedGrant,
      policy,
    );
    if (grant.allowedVenues?.length === 0) {
      toast.error("Choose a practice mode allowed by your max-loss rules");
      return;
    }
    if (grant.allowedMarkets?.length === 0) {
      toast.error("Choose at least one market allowed by your safety rules");
      return;
    }
    const redirectVenue =
      requestedVenue && grant.allowedVenues?.includes(requestedVenue)
        ? requestedVenue
        : grant.allowedVenues?.[0] ?? "mock_perps";
    pendingGrant.current = { grant, redirectVenue };
    setApprovalRequest({
      walletName: name,
      agentId,
      action: "grant_allowance",
      summary: "Set practice budget",
      targetType: "session",
      targetId: grant.id,
      details: [
        { label: "Trader", value: selectedAgent?.name ?? "Selected trader" },
        { label: "Size", value: formatUsd(grant.maxNotionalUsd) },
        { label: "Practice mode", value: grant.allowedVenues?.map(venueLabel).join(", ") ?? "Practice" },
        { label: "Open trades", value: String(grant.maxOpenPositions ?? 1) },
        { label: "Ends", value: new Date(grant.expiresAt).toLocaleString() },
      ],
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/app/wallet/${encoded}/agents/library`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Library
        </Link>
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Practice budget · {display}
        </p>
        <h1 className="font-display text-lg leading-tight text-text-strong md:text-display-xs">
          Set a practice budget
        </h1>
        {requestedTier ? (
          <p className="max-w-2xl text-xs leading-relaxed text-accent">
            {requestedTier.label} recommendation loaded.
          </p>
        ) : null}
      </header>

      {selectedAgent && activeAllowance ? (
        <section className="rounded-card border border-accent/25 bg-accent/[0.07] p-5 shadow-card-rest">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-text-strong">
                    {selectedAgent.name} already has an active budget
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-text-soft">
                    It can trade up to {formatUsd(activeAllowance.maxNotionalUsd)} per trade,
                    with {activeAllowance.maxOpenPositions ?? 1} open trade
                    {(activeAllowance.maxOpenPositions ?? 1) === 1 ? "" : "s"}, until{" "}
                    {new Date(activeAllowance.expiresAt).toLocaleString()}.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/app/wallet/${encoded}/agents/start?agent=${encodeURIComponent(selectedAgent.id)}&venue=${encodeURIComponent(activeAllowanceVenue)}`}
                className={BUTTON_CLASS}
              >
                <Play size={13} aria-hidden="true" />
                Start practice
              </Link>
              <a href="#change-allowance" className={SECONDARY_BUTTON_CLASS}>
                <ArrowRight size={13} aria-hidden="true" />
                Change budget
              </a>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div id="change-allowance" className="scroll-mt-24" />
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Clock className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">
              Practice budget
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">Trader</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className={INPUT_CLASS}
            >
              {agents.length === 0 ? (
                <option value="">No active traders</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          {setupIssue ? (
            <div className="flex items-start gap-2 rounded-soft border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{setupIssue}</span>
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-text-soft">Choose practice mode</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {VENUES.map((venue) => (
                <label
                  key={venue.value}
                  className="flex min-h-tap items-center gap-2 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong"
                >
                  <input
                    type="checkbox"
                    checked={allowedVenues.includes(venue.value)}
                    onChange={(event) =>
                      setAllowedVenues((current) =>
                        toggleValue(current, venue.value, event.target.checked),
                      )
                    }
                    className="h-4 w-4 accent-accent"
                  />
                  {venue.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">
              Markets
            </span>
            <input
              value={allowedMarkets}
              onChange={(event) => setAllowedMarkets(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Max trade size"
              value={maxNotionalUsd}
              onChange={setMaxNotionalUsd}
            />
            <TextField
              label="Max borrowing"
              value={maxLeverage}
              onChange={setMaxLeverage}
            />
            <TextField
              label="Max open trades"
              value={maxOpenPositions}
              onChange={setMaxOpenPositions}
            />
            <TextField
              label="Budget length (hours)"
              value={durationHours}
              onChange={setDurationHours}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <button type="submit" disabled={saving || !policy} className={BUTTON_CLASS}>
              <Save size={13} aria-hidden="true" />
              {saving
                ? "Saving"
                : activeAllowance
                  ? "Update budget"
                  : "Start practice"}
            </button>
          </div>
        </form>
      </section>

      <OwnerApprovalDialog
        request={approvalRequest}
        approveLabel="Approve budget"
        approvalMode={canSign ? "wallet" : "browser"}
        onCancel={cancelOwnerApproval}
        onApprove={() => void approveOwnerRequest()}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-soft">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        className={INPUT_CLASS}
      />
    </label>
  );
}

function toggleValue<T>(values: T[], value: T, checked: boolean): T[] {
  if (checked) return values.includes(value) ? values : [...values, value];
  return values.filter((item) => item !== value);
}

function venueFromSearch(value: string | null): TradingVenue | null {
  return value === "mock_perps" ||
    value === "hyperliquid_testnet" ||
    value === "bulktrade_mock"
    ? value
    : null;
}

function normalizePositiveText(value: string, fallback: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : fallback;
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveQueryNumber(value: string | null): string | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function venueLabel(value: TradingVenue): string {
  switch (value) {
    case "hyperliquid_testnet":
      return "Connected practice";
    case "bulktrade_mock":
      return "Bulk practice";
    case "mock_perps":
      return "Built-in practice";
  }
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
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-strong shadow-card-rest",
  "transition-colors hover:border-accent/60 hover:text-accent",
);
