"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { useParams, useRouter } from "next/navigation";
import { Clock, Lock, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  decryptAgentVaultPolicy,
  getAgentVaultPolicy,
  listAgents,
  newAgentSessionId,
  saveAgentSession,
  type AgentProfile,
  type AgentSessionGrant,
  type AgentVaultPolicy,
  type TradingVenue,
} from "@/lib/agents";
import { encryptStatus } from "@/lib/encrypt/client";
import { toDisplayName } from "@/lib/retail/walletNames";

const VENUES: Array<{ value: TradingVenue; label: string }> = [
  { value: "mock_perps", label: "Paper Perps" },
  { value: "hyperliquid_testnet", label: "Hyperliquid Testnet" },
  { value: "bulktrade_mock", label: "Bulk Paper" },
];

export default function NewAgentSessionPage() {
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
  const [policy, setPolicy] = useState<AgentVaultPolicy | null>(null);
  const [agentId, setAgentId] = useState("");
  const [allowedVenues, setAllowedVenues] = useState<TradingVenue[]>(["mock_perps"]);
  const [allowedMarkets, setAllowedMarkets] = useState("BTC-PERP, ETH-PERP");
  const [maxNotionalUsd, setMaxNotionalUsd] = useState("250");
  const [maxLeverage, setMaxLeverage] = useState("1");
  const [maxOpenPositions, setMaxOpenPositions] = useState("1");
  const [durationHours, setDurationHours] = useState("4");

  useEffect(() => {
    let alive = true;
    const list = listAgents(name).filter((agent) => agent.status === "active");
    setAgents(list);
    setAgentId((current) => current || list[0]?.id || "");
    decryptAgentVaultPolicy(getAgentVaultPolicy(name)).then((decrypted) => {
      if (!alive) return;
      setPolicy(decrypted);
      setAllowedVenues(decrypted.allowedVenues.length ? decrypted.allowedVenues : ["mock_perps"]);
      setAllowedMarkets(
        decrypted.allowedMarkets.length
          ? decrypted.allowedMarkets.join(", ")
          : "BTC-PERP, ETH-PERP",
      );
      setMaxNotionalUsd(decrypted.maxNotionalUsd || "250");
      setMaxLeverage(String(decrypted.maxLeverage || 1));
      setMaxOpenPositions(String(decrypted.maxOpenPositionsPerAgent || 1));
      setDurationHours(String(Math.min(decrypted.maxSessionHours || 4, 4)));
    });
    return () => {
      alive = false;
    };
  }, [name]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(() => {
      if (!agentId) {
        toast.error("Register an active agent before starting a session");
        return;
      }
      const now = Date.now();
      const hours = clampPositive(Number(durationHours), 1);
      const maxHours = policy?.maxSessionHours && policy.maxSessionHours > 0
        ? policy.maxSessionHours
        : hours;
      const boundedHours = Math.min(hours, maxHours);
      const grant: AgentSessionGrant = {
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
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      saveAgentSession(grant);
      toast.success("Trading session started");
      router.push(`/app/wallet/${encodeURIComponent(name)}/agents`);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Agent Trading · {display}
        </p>
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          Start trading session
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-soft">
          Give one active agent temporary trading authority inside your risk
          limits. Signals outside the session still get blocked.
        </p>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Clock className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">
              Session authority
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              A session can only tighten risk limits, never loosen them.
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
                <option value="">No active agents</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-text-soft">Venues</legend>
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
              Allowed markets
            </span>
            <input
              value={allowedMarkets}
              onChange={(event) => setAllowedMarkets(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Max notional"
              value={maxNotionalUsd}
              onChange={setMaxNotionalUsd}
            />
            <TextField
              label="Max leverage"
              value={maxLeverage}
              onChange={setMaxLeverage}
            />
            <TextField
              label="Max open positions"
              value={maxOpenPositions}
              onChange={setMaxOpenPositions}
            />
            <TextField
              label="Session hours"
              value={durationHours}
              onChange={setDurationHours}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-4">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-soft">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {encrypt.live ? "Privacy on" : "Privacy ready"}
            </span>
            <button type="submit" disabled={pending} className={BUTTON_CLASS}>
              <Save size={13} aria-hidden="true" />
              {pending ? "Saving" : "Start session"}
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

function normalizePositiveText(value: string, fallback: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : fallback;
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
