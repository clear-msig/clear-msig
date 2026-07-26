"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Wifi } from "lucide-react";
import { BrandSelect } from "@/components/retail/BrandSelect";
import { InfoTip } from "@/components/retail/InfoTip";
import {
  RPC_OVERRIDE_STORAGE_KEY,
  solanaClusterDefaultRpc,
  solanaClusterRpc,
} from "@/lib/solana/cluster";
import {
  EVM_RPC_OVERRIDE_STORAGE_KEY,
  appConfig,
  destinationRpcDefault,
} from "@/lib/config";
import {
  getLedgerAccountIndex,
  setLedgerAccountIndex,
  ledgerDerivationPath,
} from "@/lib/wallet/ledger";
import { useLedger } from "@/lib/wallet/LedgerProvider";

export function AdvancedSettingsControls() {
  return (
    <>
      <SolanaRpcSettingRow />
      <EvmRpcSettingRow />
      <LedgerAccountSettingRow />
    </>
  );
}
// ─── Solana RPC override ─────────────────────────────────────────

function SolanaRpcSettingRow() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Read the currently-active value from localStorage on mount so a
  // user who saved an override sees their URL pre-filled. (We can't
  // just import `solanaClusterRpc` here - that const is captured at
  // module init, before localStorage was readable on first SSR-ish
  // pass, so it may not reflect what's actually stored.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(RPC_OVERRIDE_STORAGE_KEY) ?? "";
      setDraft(v);
    } catch {
      /* ignore */
    }
  }, []);

  const trimmed = draft.trim();
  // Match the validator in `lib/solana/cluster.ts`: HTTPS-only,
  // localhost exception. Plain HTTP is rejected so a passive network
  // observer can't manipulate balance / blockhash responses.
  const httpsOk = /^https:\/\/[^\s]+$/i.test(trimmed);
  const localhostOk = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/i.test(
    trimmed,
  );
  const looksValid = httpsOk || localhostOk;
  const hasOverride = trimmed.length > 0 && looksValid;
  const effectiveUrl = solanaClusterRpc;
  const isUsingOverride = effectiveUrl !== solanaClusterDefaultRpc;

  const handleSave = () => {
    if (!hasOverride) return;
    setBusy(true);
    try {
      window.localStorage.setItem(RPC_OVERRIDE_STORAGE_KEY, trimmed);
    } catch {
      setBusy(false);
      return;
    }
    // Hard reload so the module-init RPC singleton picks up the new
    // URL. The override is read at module load, not per-call.
    window.location.reload();
  };
  const handleReset = () => {
    setBusy(true);
    try {
      window.localStorage.removeItem(RPC_OVERRIDE_STORAGE_KEY);
    } catch {
      /* fall through to reload */
    }
    window.location.reload();
  };

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      {/* Title row - explainer copy lives behind the info icon to
          keep the section compact. The active-URL chip below is
          the only status info that always shows. */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-text-strong">
            Solana RPC URL
            <InfoTip
              label="About the Solana RPC override"
              title="Solana RPC URL"
              width="md"
              size="xs"
            >
              <span className="block">
                Override the default with your own RPC (Helius, QuickNode,
                Triton). Saved on this device only.
              </span>
            </InfoTip>
          </p>
        </div>
        <span
          className={
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] " +
            (isUsingOverride
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border-soft bg-canvas text-text-soft")
          }
        >
          {isUsingOverride ? "Override" : "Default"}
        </span>
      </div>

      {/* Active URL - one-line truncated, full URL behind tooltip. */}
      <p className="mt-3 inline-flex max-w-full items-center gap-1.5 text-[11px] text-text-soft">
        <span className="truncate font-mono text-text-strong" title={effectiveUrl}>
          {effectiveUrl}
        </span>
        <InfoTip label="Show full RPC URL" title="Active Solana RPC" width="md" size="xs">
          <span className="block break-all font-mono text-[11px] text-text-strong">
            {effectiveUrl}
          </span>
        </InfoTip>
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          aria-label="Solana RPC URL"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://your-rpc.example.com"
          spellCheck={false}
          className={
            "min-w-0 flex-1 rounded-soft border border-glass-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
            "transition-colors duration-base ease-out-soft focus:border-glass-strong"
          }
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasOverride || busy}
            className={
              "inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
              "transition-[background-color,transform] duration-base ease-out-soft " +
              "hover:bg-accent-hover active:scale-[0.98] " +
              "disabled:cursor-not-allowed disabled:opacity-50 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            Save & reload
          </button>
          {isUsingOverride && (
            <button
              type="button"
              onClick={handleReset}
              disabled={busy}
              className={
                "inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:text-accent " +
                "disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              Reset
            </button>
          )}
        </div>
      </div>
      {trimmed.length > 0 && !hasOverride && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-warning">
          Use https:// (or http://localhost for dev).
          <InfoTip
            label="Why HTTPS only"
            title="Why HTTPS only"
            width="md"
            size="xs"
          >
            <span className="block">
              Plain HTTP is rejected so a passive observer can&rsquo;t modify
              balance / blockhash responses while you&rsquo;re reading from
              the RPC.
            </span>
          </InfoTip>
        </p>
      )}
    </section>
  );
}

// ─── Ledger account index ────────────────────────────────────────

function LedgerAccountSettingRow() {
  const ledger = useLedger();
  const [index, setIndex] = useState<number>(0);
  const [savedIndex, setSavedIndex] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const v = getLedgerAccountIndex();
    setIndex(v);
    setSavedIndex(v);
  }, []);

  // Hide the row entirely on browsers without WebHID. The user
  // can't connect a Ledger here, so the picker would just be
  // confusing chrome.
  if (typeof navigator !== "undefined" && !("hid" in navigator)) {
    return null;
  }

  const dirty = index !== savedIndex;
  const sessionActive = !!ledger.session;
  const sessionIndex = ledger.session
    ? parseLedgerAccountFromPath(ledger.session.derivationPath)
    : null;

  const handleSave = async () => {
    if (!dirty) return;
    setBusy(true);
    try {
      setLedgerAccountIndex(index);
      setSavedIndex(index);
      // If a session is active, reconnect so the new derivation
      // path takes effect immediately. Without this, the saved
      // index applies only to subsequent fresh connects.
      if (sessionActive) {
        try {
          await ledger.disconnect();
        } catch {
          /* swallow - connect below will surface a real error */
        }
        try {
          await ledger.connect();
        } catch {
          /* user can re-trigger from /connect; we already saved */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Ledger account index
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Pick a different Solana account on your Ledger when one device
            hosts more than one. Saving while connected will reconnect.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {sessionActive
          ? `Active session: account ${sessionIndex ?? savedIndex}`
          : `Will use account ${savedIndex}`}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
        {ledgerDerivationPath(sessionIndex ?? savedIndex)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
          Account
        </span>
        <BrandSelect
          value={String(index)}
          onChange={(v) => setIndex(parseInt(v, 10))}
          ariaLabel="Ledger account index"
          options={Array.from({ length: 10 }, (_, i) => ({
            value: String(i),
            label: `Account ${i}`,
            description: ledgerDerivationPath(i),
          }))}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || busy}
          className={
            "ml-auto inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
            "transition-[background-color,transform] duration-base ease-out-soft " +
            "hover:bg-accent-hover active:scale-[0.98] " +
            "disabled:cursor-not-allowed disabled:opacity-50 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          {sessionActive ? "Save & reconnect" : "Save"}
        </button>
      </div>
    </section>
  );
}

function parseLedgerAccountFromPath(path: string): number | null {
  // path looks like "44'/501'/<n>'" - pull <n>.
  const m = path.match(/^44'\/501'\/(\d+)'$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

// ─── EVM destination RPC override ────────────────────────────────

function EvmRpcSettingRow() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v =
        window.localStorage.getItem(EVM_RPC_OVERRIDE_STORAGE_KEY) ?? "";
      setDraft(v);
    } catch {
      /* ignore */
    }
  }, []);

  const trimmed = draft.trim();
  const looksValid = /^https?:\/\/[^\s]+$/i.test(trimmed);
  const hasOverride = trimmed.length > 0 && looksValid;
  const effectiveUrl = appConfig.preAlpha.destinationRpcUrl;
  const isUsingOverride = effectiveUrl !== destinationRpcDefault;

  const handleSave = () => {
    if (!hasOverride) return;
    setBusy(true);
    try {
      window.localStorage.setItem(EVM_RPC_OVERRIDE_STORAGE_KEY, trimmed);
    } catch {
      setBusy(false);
      return;
    }
    window.location.reload();
  };
  const handleReset = () => {
    setBusy(true);
    try {
      window.localStorage.removeItem(EVM_RPC_OVERRIDE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      {/* Title row - explainer copy lives behind the info icon to
          keep the section compact. The active-URL chip below is
          the only status info that always shows. */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-text-strong">
            EVM destination RPC URL
            <InfoTip
              label="About the EVM RPC override"
              title="EVM destination RPC URL"
              width="md"
              size="xs"
            >
              <span className="block">
                Used for ETH / ERC-20 reads (balance, gas, holdings) and the
                Ika broadcast leg. Override when the public Sepolia RPC is
                rate-limited.
              </span>
            </InfoTip>
          </p>
        </div>
        <span
          className={
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] " +
            (isUsingOverride
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border-soft bg-canvas text-text-soft")
          }
        >
          {isUsingOverride ? "Override" : "Default"}
        </span>
      </div>

      {/* Active URL - one-line truncated, full URL behind tooltip. */}
      <p className="mt-3 inline-flex max-w-full items-center gap-1.5 text-[11px] text-text-soft">
        <span className="truncate font-mono text-text-strong" title={effectiveUrl}>
          {effectiveUrl}
        </span>
        <InfoTip label="Show full RPC URL" title="Active EVM RPC" width="md" size="xs">
          <span className="block break-all font-mono text-[11px] text-text-strong">
            {effectiveUrl}
          </span>
        </InfoTip>
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          aria-label="EVM RPC URL"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://your-evm-rpc.example.com"
          spellCheck={false}
          className={
            "min-w-0 flex-1 rounded-soft border border-glass-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
            "transition-colors duration-base ease-out-soft focus:border-glass-strong"
          }
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasOverride || busy}
            className={
              "inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
              "transition-[background-color,transform] duration-base ease-out-soft " +
              "hover:bg-accent-hover active:scale-[0.98] " +
              "disabled:cursor-not-allowed disabled:opacity-50 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            Save & reload
          </button>
          {isUsingOverride && (
            <button
              type="button"
              onClick={handleReset}
              disabled={busy}
              className={
                "inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:text-accent " +
                "disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              Reset
            </button>
          )}
        </div>
      </div>
      {trimmed.length > 0 && !hasOverride && (
        <p className="mt-2 text-xs text-warning">
          Must be a valid http(s) URL.
        </p>
      )}
    </section>
  );
}
