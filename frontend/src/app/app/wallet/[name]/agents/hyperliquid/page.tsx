"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  RefreshCw,
  Server,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  buildAgentHyperliquidSetupSummary,
  getAgentHyperliquidSetupSettings,
  saveAgentHyperliquidSetupSettings,
  updateAgentHyperliquidDelegationStatus,
  type AgentHyperliquidSetupSettings,
  type AgentHyperliquidSetupStep,
} from "@/lib/agents";
import {
  loadAgentVenueReadiness,
  type AgentVenueReadiness,
} from "@/lib/agents/clientExecution";
import { toDisplayName } from "@/lib/retail/walletNames";

const EMPTY_SETTINGS: AgentHyperliquidSetupSettings = {
  accountAddress: "",
  agentWalletAddress: "",
  delegationStatus: "not_started",
  updatedAt: 0,
  version: 1,
};

export default function HyperliquidSetupPage() {
  const params = useParams<{ name: string }>();
  const toast = useToast();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [settings, setSettings] =
    useState<AgentHyperliquidSetupSettings>(EMPTY_SETTINGS);
  const [accountDraft, setAccountDraft] = useState("");
  const [agentWalletDraft, setAgentWalletDraft] = useState("");
  const [readiness, setReadiness] = useState<AgentVenueReadiness | null>(null);
  const [checking, setChecking] = useState(true);

  const checkReadiness = useCallback(async (accountAddress: string) => {
    setChecking(true);
    try {
      const next = await loadAgentVenueReadiness("hyperliquid_testnet", {
        accountAddress,
      });
      setReadiness(next);
    } catch {
      setReadiness(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const loaded = getAgentHyperliquidSetupSettings(name);
    setSettings(loaded);
    setAccountDraft(loaded.accountAddress);
    setAgentWalletDraft(loaded.agentWalletAddress);
    void checkReadiness(loaded.accountAddress);
  }, [checkReadiness, name]);

  const summary = useMemo(
    () => buildAgentHyperliquidSetupSummary(readiness, settings),
    [readiness, settings],
  );
  const accountAddress =
    readiness?.accountSnapshot?.accountAddress ??
    readiness?.accountProbe?.accountAddress ??
    settings.accountAddress;
  const accountSnapshot = readiness?.accountSnapshot ?? null;
  const executor = readiness?.executorProbe ?? null;
  const agentWalletAddress =
    executor?.agentWalletAddress ?? settings.agentWalletAddress;

  const saveAndCheck = () => {
    try {
      const saved = saveAgentHyperliquidSetupSettings(name, {
        accountAddress: accountDraft,
        agentWalletAddress: agentWalletDraft,
      });
      setSettings(saved);
      setAccountDraft(saved.accountAddress);
      setAgentWalletDraft(saved.agentWalletAddress);
      toast.success(saved.accountAddress ? "Hyperliquid delegation saved" : "Hyperliquid setup cleared");
      void checkReadiness(saved.accountAddress);
    } catch (error) {
      toast.error("Could not save Hyperliquid account", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const setDelegationStatus = (
    status: "active" | "rotation_required" | "revoked",
  ) => {
    try {
      const updated = updateAgentHyperliquidDelegationStatus({
        walletName: name,
        status,
        reason:
          status === "rotation_required"
            ? "Rotate this API wallet before further beta trading."
            : undefined,
      });
      setSettings(updated);
      toast.success(
        status === "active"
          ? "API wallet marked active"
          : status === "revoked"
            ? "API wallet marked revoked"
            : "API wallet marked for rotation",
      );
      void checkReadiness(updated.accountAddress);
    } catch (error) {
      toast.error("Could not update API wallet status", {
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
              Hyperliquid Practice - {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Hyperliquid practice setup
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              Add one dedicated testnet account, fund it with practice
              collateral, and let ClearSig check the protected server connection
              before agents can trade.
            </p>
          </div>
          <Link
            href={`/app/wallet/${encoded}/agents/start?venue=hyperliquid_testnet`}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent-strong"
          >
            Continue trading
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusIcon status={summary.status} checking={checking} />
              <h2 className="text-sm font-semibold text-text-strong">
                {checking ? "Checking Hyperliquid practice" : summary.headline}
              </h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              This stores only the public account address in your browser.
              Private executor tokens and the API wallet private key must never
              enter this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void checkReadiness(settings.accountAddress)}
            disabled={checking}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", checking && "animate-spin")} aria-hidden="true" />
            Check
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-card border border-border-soft bg-canvas p-4">
            <label
              htmlFor="hyperliquid-account"
              className="text-xs font-semibold text-text-strong"
            >
              Practice account address
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="hyperliquid-account"
                value={accountDraft}
                onChange={(event) => setAccountDraft(event.target.value)}
                placeholder="0x..."
                autoComplete="off"
                spellCheck={false}
                className="min-h-10 min-w-0 flex-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 font-mono text-xs text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
              <button
                type="button"
                onClick={saveAndCheck}
                disabled={checking}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save and check
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <label
              htmlFor="hyperliquid-agent-wallet"
              className="mt-4 block text-xs font-semibold text-text-strong"
            >
              Approved API wallet address
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="hyperliquid-agent-wallet"
                value={agentWalletDraft}
                onChange={(event) => setAgentWalletDraft(event.target.value)}
                placeholder="0x... delegated API wallet"
                autoComplete="off"
                spellCheck={false}
                className="min-h-10 min-w-0 flex-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 font-mono text-xs text-text-strong outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
              <a
                href="https://app.hyperliquid-testnet.xyz/API"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-4 py-2 text-xs font-semibold text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
              >
                Approve on Hyperliquid
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-soft">
              This should be the public address of a separate API/agent wallet
              approved by the funded account. The private key belongs only in
              the protected executor or a user-owned agent runtime.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="https://app.hyperliquid-testnet.xyz/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
              >
                Open Hyperliquid testnet
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <Link
                href={`/app/wallet/${encoded}/agents/policy?venue=hyperliquid_testnet`}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
              >
                Safety rules
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="grid gap-2">
            {summary.steps.map((step) => (
              <SetupStepRow key={step.id} step={step} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Delegation model
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              This follows the standard AI trading pattern: user funds stay in
              the trading account, a separate API wallet is approved as the
              signer, ClearSig checks every action against allowance and safety
              rules, and the private signing key stays out of the browser.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <MiniMetric label="Funds live in" value="Hyperliquid account" />
          <MiniMetric label="Signer identity" value="Approved API wallet" />
          <MiniMetric label="Limits enforced by" value="ClearSig policy" />
          <MiniMetric label="Private key location" value="Protected executor" />
        </div>
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Delegated signer lifecycle
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              Rotate or revoke the approved API wallet whenever it is exposed,
              no longer needed, or no longer matches the protected executor.
              Revoke on Hyperliquid first, then mark the status here for
              ClearSig checks and operator review.
            </p>
          </div>
          <span
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              settings.delegationStatus === "active"
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : settings.delegationStatus === "revoked"
                  ? "border-danger/30 bg-danger/[0.06] text-danger"
                  : settings.delegationStatus === "rotation_required"
                    ? "border-warning/30 bg-warning/[0.08] text-warning"
                    : "border-border-soft bg-canvas text-text-soft",
            )}
          >
            {delegationStatusLabel(settings.delegationStatus)}
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <MiniMetric
            label="Approved"
            value={settings.approvedAt ? formatDate(settings.approvedAt) : "-"}
          />
          <MiniMetric
            label="Revoked"
            value={settings.revokedAt ? formatDate(settings.revokedAt) : "-"}
          />
          <MiniMetric
            label="Rotation note"
            value={settings.rotationReason ?? "None"}
          />
          <MiniMetric
            label="Current signer"
            value={settings.agentWalletAddress ? shortAddress(settings.agentWalletAddress) : "Not set"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!settings.agentWalletAddress || settings.delegationStatus === "active"}
            onClick={() => setDelegationStatus("active")}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Mark active
          </button>
          <button
            type="button"
            disabled={!settings.agentWalletAddress || settings.delegationStatus === "rotation_required"}
            onClick={() => setDelegationStatus("rotation_required")}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-warning/30 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Require rotation
          </button>
          <button
            type="button"
            disabled={!settings.agentWalletAddress || settings.delegationStatus === "revoked"}
            onClick={() => setDelegationStatus("revoked")}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-danger/30 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Mark revoked
          </button>
          <a
            href="https://app.hyperliquid-testnet.xyz/API"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
          >
            Manage on Hyperliquid
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric
          label="Account"
          value={accountAddress ? shortAddress(accountAddress) : "Not set"}
          highlight={Boolean(accountAddress)}
        />
        <Metric
          label="API wallet"
          value={agentWalletAddress ? shortAddress(agentWalletAddress) : "Not approved"}
          highlight={Boolean(agentWalletAddress)}
        />
        <Metric
          label="Account value"
          value={formatUsd(accountSnapshot?.accountValueUsd)}
          highlight={Number(accountSnapshot?.accountValueUsd ?? 0) > 0}
        />
        <Metric
          label="Withdrawable"
          value={formatUsd(accountSnapshot?.withdrawableUsd)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
        <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <div className="flex items-start gap-3">
            <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Open Hyperliquid positions
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-text-soft">
                When ClearSig submits a practice trade, this panel shows what
                the exchange account reports back.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {accountSnapshot?.positions.length ? (
              accountSnapshot.positions.map((position) => (
                <div
                  key={`${position.market}:${position.side}:${position.size}`}
                  className="rounded-soft border border-border-soft bg-canvas p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-text-strong">
                      {position.market} - {position.side}
                    </p>
                    <span className={clsx("text-xs font-semibold", signedTone(position.unrealizedPnlUsd))}>
                      {formatSignedUsd(position.unrealizedPnlUsd)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <MiniMetric label="Size" value={position.size} />
                    <MiniMetric label="Entry" value={formatUsd(position.entryPriceUsd)} />
                    <MiniMetric label="Value" value={formatUsd(position.positionValueUsd)} />
                    <MiniMetric label="ROE" value={position.returnOnEquityPct ? `${position.returnOnEquityPct}%` : "-"} />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-card border border-dashed border-border-soft bg-canvas p-5 text-sm text-text-soft">
                No Hyperliquid practice positions are open right now.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Server
                className={clsx(
                  "mt-0.5 h-4 w-4 shrink-0",
                  executor?.state === "ready" ? "text-accent" : "text-warning",
                )}
                aria-hidden="true"
              />
              <div>
                <h2 className="text-sm font-semibold text-text-strong">
                  Protected trading connection
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-text-soft">
                  ClearSig manages the private executor connection outside this
                  screen. You only need to prepare the practice account and keep
                  your API wallet delegation plus safety rules tight.
                </p>
              </div>
            </div>
            <span
              className={clsx(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                executor?.state === "ready"
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
              )}
            >
              {executor?.state === "ready" ? "Connected" : "Checking"}
            </span>
          </div>
          <div className="mt-4 rounded-soft border border-border-soft bg-canvas p-3">
            <p className="text-xs font-semibold text-text-strong">
              {executor?.state === "ready"
                ? "Ready for protected practice trades"
                : "No action needed in this screen"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {executor?.state === "ready"
                ? "The server-side connection is available. ClearSig can submit only approved trades that fit your allowance."
                : "If this stays unavailable after your account is funded and the API wallet is approved, ClearSig needs to finish the protected executor for this workspace."}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkReadiness(settings.accountAddress)}
              disabled={checking}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", checking && "animate-spin")} aria-hidden="true" />
              Check connection
            </button>
            <Link
              href={`/app/wallet/${encoded}/agents/start?venue=hyperliquid_testnet`}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
            >
              Continue
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function SetupStepRow({ step }: { step: AgentHyperliquidSetupStep }) {
  const ready = step.status === "ready";
  const blocked = step.status === "blocked";
  return (
    <div
      className={clsx(
        "rounded-card border p-3",
        ready
          ? "border-accent/30 bg-accent/[0.07]"
          : blocked
            ? "border-warning/30 bg-warning/[0.08]"
            : "border-border-soft bg-canvas",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            ready
              ? "border-accent/30 text-accent"
              : blocked
                ? "border-warning/30 text-warning"
                : "border-border-soft text-text-muted",
          )}
        >
          {ready ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : blocked ? (
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

function StatusIcon({
  status,
  checking,
}: {
  status: "ready" | "needs_setup" | "blocked";
  checking: boolean;
}) {
  return (
    <span
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-full",
        status === "ready"
          ? "bg-accent/10 text-accent"
          : "bg-warning/[0.08] text-warning",
      )}
    >
      {checking ? (
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : status === "ready" ? (
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      )}
    </span>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className={clsx("mt-1 break-words text-sm font-semibold", highlight ? "text-accent" : "text-text-strong")}>
        {value}
      </p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
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

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return `$${parsed.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedUsd(value: string | number | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function signedTone(value: string | number | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "text-text-strong";
  return parsed > 0 ? "text-accent" : "text-rose-300";
}

function delegationStatusLabel(
  status: AgentHyperliquidSetupSettings["delegationStatus"],
): string {
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
