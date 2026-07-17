"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowRight, AlertTriangle, Check, ExternalLink, Info, ShieldCheck } from "lucide-react";
import { type AgentComplianceReadiness, type AgentHyperliquidSetupSettings, type AgentProfile, type AgentVenueReadiness } from "@/features/agents/domain";
import { CheckStat } from "@/features/agents/ui/start/VenueRows";
import { shortAddress } from "@/features/agents/ui/start/presentation";

export function ComplianceDisclosurePanel({
  readiness,
  pending,
  onAccept,
}: {
  readiness: AgentComplianceReadiness;
  pending: boolean;
  onAccept: () => void;
}) {
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest sm:p-5",
        readiness.accepted
          ? "border-accent/25 bg-accent/[0.05]"
          : "border-warning/30 bg-warning/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              readiness.accepted
                ? "bg-accent/10 text-accent"
                : "bg-warning/[0.12] text-warning",
            )}
          >
            {readiness.accepted ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Trading disclosures
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-soft">
              {readiness.accepted
                ? "Accepted for this wallet and venue."
                : "Required before automation."}
            </p>
          </div>
        </div>
        {readiness.accepted ? (
          <span className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-1 text-[11px] font-medium text-accent">
            Accepted
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={onAccept}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Accept disclosures
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {readiness.accepted ? (
        <details className="group mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-text-strong">
            <span className="inline-flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              Review disclosure details
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 text-text-soft transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <DisclosureItems readiness={readiness} />
        </details>
      ) : (
        <DisclosureItems readiness={readiness} className="mt-4" />
      )}
    </section>
  );
}
export function DisclosureItems({
  readiness,
  className,
}: {
  readiness: AgentComplianceReadiness;
  className?: string;
}) {
  return (
    <div className={clsx("grid gap-2 md:grid-cols-2", className)}>
      {readiness.required.map((item) => {
        const accepted = !readiness.missing.some((missing) => missing.id === item.id);
        return (
          <div
            key={item.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  accepted ? "bg-accent" : "bg-warning",
                )}
              />
              <p className="text-xs font-semibold text-text-strong">
                {item.label}
              </p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {item.summary}
            </p>
          </div>
        );
      })}
    </div>
  );
}
export function AutomaticTradingStatus({
  agent,
  enabled,
  busy,
  approvalOpen,
}: {
  agent: AgentProfile | null;
  enabled: boolean;
  busy: boolean;
  approvalOpen: boolean;
}) {
  const tone = enabled
    ? "border-accent/30 bg-accent/[0.08] text-accent"
    : approvalOpen || busy
      ? "border-warning/30 bg-warning/[0.08] text-warning"
      : "border-border-soft bg-canvas text-text-soft";
  const label = enabled
    ? "Automatic trading is on"
    : approvalOpen
      ? "Approval is open"
      : busy
        ? "Turning on automatic trading"
        : agent
          ? "Automatic trading is off"
          : "Choose a trader first";
  return (
    <li className={clsx("rounded-soft border px-3 py-2.5", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">{label}</p>
        <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] font-medium">
          Automation
        </span>
      </div>
    </li>
  );
}
export function HyperliquidHelp({
  readiness,
  walletEncoded,
  setupSettings,
}: {
  readiness: AgentVenueReadiness | null;
  walletEncoded: string;
  setupSettings: AgentHyperliquidSetupSettings;
}) {
  const account = readiness?.accountProbe;
  const protectedConnection = readiness?.executorProbe;
  const executorApiWallet = protectedConnection?.agentWalletAddress ?? "";
  const savedApiWallet = setupSettings.agentWalletAddress;
  const apiWalletHealthy =
    protectedConnection?.state === "ready" &&
    setupSettings.delegationStatus === "active" &&
    Boolean(savedApiWallet) &&
    Boolean(executorApiWallet) &&
    savedApiWallet.toLowerCase() === executorApiWallet.toLowerCase();
  const apiWalletMismatch =
    Boolean(savedApiWallet) &&
    Boolean(executorApiWallet) &&
    savedApiWallet.toLowerCase() !== executorApiWallet.toLowerCase();
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <h2 className="text-sm font-semibold text-text-strong">Practice account</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <CheckStat
          label="Account"
          value={account?.accountAddress ? shortAddress(account.accountAddress) : "Not connected"}
          ready={Boolean(account?.accountAddress)}
        />
        <CheckStat
          label="Practice funds"
          value={account?.state === "funded" ? "Confirmed" : account?.state === "empty" ? "Needed" : "Not confirmed"}
          ready={account?.state === "funded"}
        />
        <CheckStat
          label="Trading key"
          value={
            savedApiWallet
              ? apiWalletHealthy
                ? "Active"
                : setupSettings.delegationStatus === "revoked"
                  ? "Revoked"
                  : apiWalletMismatch
                    ? "Mismatch"
                    : "Verify"
              : "Needed"
          }
          ready={apiWalletHealthy}
        />
        <CheckStat
          label="Connection"
          value={protectedConnection?.state === "ready" ? "Ready" : "Pending"}
          ready={protectedConnection?.state === "ready"}
        />
      </div>
      {!apiWalletHealthy && savedApiWallet ? (
        <div className="mt-4 rounded-soft border border-warning/30 bg-warning/[0.08] p-3">
          <p className="text-xs font-semibold text-warning">
            Trading key not ready
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {apiWalletMismatch
              ? "The saved trading key does not match the connected practice account."
              : setupSettings.delegationStatus === "revoked"
                ? "Approve and save a new trading key."
                : setupSettings.rotationReason ??
                "Check the practice connection before trading."}
          </p>
        </div>
      ) : null}
      <details className="group mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-text-strong">
          <span>Setup steps</span>
          <ArrowRight
            className="h-3.5 w-3.5 text-text-soft transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <ol className="mt-3 grid gap-2 border-t border-border-soft pt-3">
          {[
            "Open Hyperliquid practice and sign in with a separate account.",
            "Add practice funds to that account.",
            "Approve a separate trading key for agent practice.",
            "Save the account address and approved trading key in ClearSig.",
            "Check again.",
          ].map((instruction, index) => (
            <li key={instruction} className="flex items-start gap-3 text-xs leading-relaxed text-text-soft">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-soft text-[10px] font-semibold text-text-strong">
                {index + 1}
              </span>
              {instruction}
            </li>
          ))}
        </ol>
      </details>
      {readiness && protectedConnection?.state !== "ready" ? (
        <div className="mt-4 rounded-soft border border-warning/30 bg-warning/[0.08] p-3">
          <p className="text-xs font-semibold text-warning">Protected connection pending</p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="https://app.hyperliquid-testnet.xyz/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          Open practice account
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <Link
          href={`/app/wallet/${walletEncoded}/agents/hyperliquid`}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          Guide
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
