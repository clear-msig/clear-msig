"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Lock, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { FormField, TextInput } from "@/components/retail/FormField";
import { useToast } from "@/components/ui/Toast";
import {
  decryptAgentVaultPolicy,
  encryptAgentVaultPolicy,
  getAgentVaultPolicy,
  listAgentSessions,
  saveAgentVaultPolicy,
  syncAgentVaultPolicy,
  type AgentVaultPolicy,
  type TradingVenue,
} from "@/lib/agents/client";
import { encryptStatus } from "@/lib/encrypt/client";
import { toDisplayName } from "@/lib/retail/walletNames";

const VENUES: Array<{ value: TradingVenue; label: string }> = [
  { value: "mock_perps", label: "Built-in practice" },
  { value: "hyperliquid_testnet", label: "Connected practice" },
  { value: "bulktrade_mock", label: "Bulk practice" },
];

export default function AgentPolicyPage() {
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
  const requestedVenue = venueFromSearch(search.get("venue"));
  const requestedAgent = search.get("agent")?.trim() ?? "";

  const [policy, setPolicy] = useState<AgentVaultPolicy | null>(null);
  const [markets, setMarkets] = useState("");

  useEffect(() => {
    let alive = true;
    decryptAgentVaultPolicy(getAgentVaultPolicy(name)).then((decrypted) => {
      if (!alive) return;
      setPolicy(
        requestedVenue && !decrypted.allowedVenues.includes(requestedVenue)
          ? {
              ...decrypted,
              allowedVenues: [...decrypted.allowedVenues, requestedVenue],
            }
          : decrypted,
      );
      setMarkets(decrypted.allowedMarkets.join(", "));
    });
    return () => {
      alive = false;
    };
  }, [name, requestedVenue]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!policy) return;
    startTransition(async () => {
      const now = Date.now();
      const cleaned: AgentVaultPolicy = {
        ...policy,
        allowedMarkets: markets
          .split(",")
          .map((market) => market.trim().toUpperCase())
          .filter(Boolean),
        maxNotionalUsd: normalizePositiveText(policy.maxNotionalUsd, "500"),
        maxLeverage: normalizePositiveNumber(policy.maxLeverage, 2),
        maxOpenPositionsPerAgent: normalizePositiveNumber(
          policy.maxOpenPositionsPerAgent,
          1,
        ),
        cooldownSeconds: Math.max(0, Math.floor(policy.cooldownSeconds || 0)),
        maxSessionHours: normalizePositiveNumber(policy.maxSessionHours, 24),
        dailyLossCapUsd: normalizePositiveText(policy.dailyLossCapUsd, "100"),
        updatedAt: now,
      };
      try {
        const encrypted = await encryptAgentVaultPolicy(cleaned);
        const sessionsNeedRenewal =
          encrypted.policyHash !== policy.policyHash &&
          listAgentSessions(name).some(
            (session) =>
              session.status === "active" && session.expiresAt > Date.now(),
          );
        saveAgentVaultPolicy(encrypted);
        const synced = await syncAgentVaultPolicy(encrypted);
        if (synced.ok) {
          toast.success(
            sessionsNeedRenewal
              ? "Max-loss rules saved. Review current budgets."
              : "Safety rules saved",
          );
        } else {
          toast.info(
            sessionsNeedRenewal
              ? "Max-loss rules saved here. Review current budgets."
              : "Safety rules saved on this device for now",
            {
            details: synced.message,
            },
          );
        }
        router.push(
          `/app/wallet/${encodeURIComponent(name)}/agents/start?agent=${encodeURIComponent(requestedAgent)}&venue=${encodeURIComponent(requestedVenue ?? "mock_perps")}`,
        );
      } catch (err) {
        toast.error("Could not save safety rules", {
          details: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  if (!policy) {
    return <div className="text-sm text-text-soft">Loading safety rules...</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Max loss · {display}
        </p>
        <h1 className="font-display text-lg leading-tight text-text-strong md:text-display-xs">
          Set max loss
        </h1>
      </header>

      <section className="rounded-card bg-surface-raised p-5 shadow-card-rest sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-strong">
              Rules that always win
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Allow automated trading"
              checked={policy.enabled}
              onChange={(checked) => setPolicy({ ...policy, enabled: checked })}
            />
            <Toggle
              label="Stop all trading"
              checked={policy.emergencyPaused}
              onChange={(checked) =>
                setPolicy({ ...policy, emergencyPaused: checked })
              }
            />
          </div>

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
                    checked={policy.allowedVenues.includes(venue.value)}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        allowedVenues: toggleValue(
                          policy.allowedVenues,
                          venue.value,
                          event.target.checked,
                        ),
                      })
                    }
                    className="h-4 w-4 accent-accent"
                  />
                  {venue.label}
                </label>
              ))}
            </div>
          </fieldset>

          <FormField label="Markets">
            <TextInput
              value={markets}
              onChange={(event) => setMarkets(event.target.value)}
              placeholder="BTC-PERP, ETH-PERP, SOL-PERP"
            />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Max trade size"
              value={policy.maxNotionalUsd}
              onChange={(value) => setPolicy({ ...policy, maxNotionalUsd: value })}
            />
            <NumberField
              label="Max borrowing"
              value={String(policy.maxLeverage)}
              onChange={(value) => setPolicy({ ...policy, maxLeverage: Number(value) })}
            />
            <NumberField
              label="Max open trades"
              value={String(policy.maxOpenPositionsPerAgent)}
              onChange={(value) =>
                setPolicy({ ...policy, maxOpenPositionsPerAgent: Number(value) })
              }
            />
            <NumberField
              label="Rest time between trades (seconds)"
              value={String(policy.cooldownSeconds)}
              onChange={(value) =>
                setPolicy({ ...policy, cooldownSeconds: Number(value) })
              }
            />
            <NumberField
              label="Budget length (hours)"
              value={String(policy.maxSessionHours)}
              onChange={(value) =>
                setPolicy({ ...policy, maxSessionHours: Number(value) })
              }
            />
            <NumberField
              label="Daily loss limit"
              value={policy.dailyLossCapUsd}
              onChange={(value) => setPolicy({ ...policy, dailyLossCapUsd: value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Require a loss exit"
              checked={policy.requireStopLoss}
              onChange={(checked) =>
                setPolicy({ ...policy, requireStopLoss: checked })
              }
            />
            <Toggle
              label="Require a profit target"
              checked={policy.requireTakeProfit}
              onChange={(checked) =>
                setPolicy({ ...policy, requireTakeProfit: checked })
              }
            />
          </div>

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
              {pending ? "Saving" : "Save safety rules"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-tap items-center justify-between gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-accent"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label}>
      <TextInput
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
      />
    </FormField>
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

function normalizePositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
