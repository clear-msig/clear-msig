"use client";

// Settings — minimal retail account screen.
//
// What a non-technical user needs from a settings surface:
//   - Confirmation they're connected, with a copyable identity.
//   - Which network ("Test network" — the preview banner says the
//     same, this is a quieter restatement).
//   - A clear way to sign out.
//
// Everything else (chain switching, RPC URL, intent template editor,
// raw address display) is a power-user concern. Out of scope here.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useWallet } from "@/lib/wallet";
import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  Contact,
  Copy,
  Download,
  ExternalLink,
  Lock,
  LogOut,
  Share2,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import { useInstallPrompt } from "@/lib/hooks/useInstallPrompt";
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

export default function SettingsPage() {
  const router = useRouter();
  const wallet = useWallet();
  const reduce = useReducedMotion();
  const notif = useActionNotifications();
  const install = useInstallPrompt();

  const address = wallet.publicKey?.toBase58() ?? "";
  const short = useMemo(
    () => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : ""),
    [address],
  );

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  const handleDisconnect = async () => {
    try {
      await wallet.disconnect();
    } finally {
      router.replace("/");
    }
  };

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <header className="text-center">
        <h1 className="font-display text-display-xs leading-tight text-text-strong">
          Settings
        </h1>
        <p className="mt-1 text-base text-text-soft">
          Your account and connection.
        </p>
      </header>

      {/* Connected identity card */}
      <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Your wallet
        </p>

        {address ? (
          <>
            <div className="mt-3 flex items-center gap-3">
              <MemberAvatar address={address} size="lg" />
              <p className="inline-flex items-center gap-2 text-base text-text-strong">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                Connected
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Address copied" : "Copy your wallet address"}
              className={
                "group mt-4 flex w-full items-center justify-between gap-3 rounded-card " +
                "border border-border-soft bg-canvas px-4 py-3 " +
                "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              <span className="font-mono text-sm text-text-strong">{short}</span>
              <span
                className={
                  "flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-base ease-out-soft " +
                  (copied
                    ? "text-accent"
                    : "text-text-soft group-hover:text-accent")
                }
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </span>
            </button>
            <p className="mt-2 text-xs text-text-soft">
              Friends use this when they want to send you money outside a
              shared wallet.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-text-soft">
            You&rsquo;re not connected.
          </p>
        )}
      </section>

      {/* Contacts row — your local address book. */}
      <Link
        href="/app/contacts"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Contact className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Contacts</p>
          <p className="mt-0.5 text-xs text-text-soft">
            Names you&rsquo;ve saved for sending money.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

      {/* Privacy row — links to the explainer. Status flips
          automatically when Encrypt's network goes live. */}
      <Link
        href="/privacy"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Lock className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Privacy
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            How your wallet&rsquo;s rules stay private. Encryption-ready,
            switches on when Encrypt&rsquo;s network leaves pre-alpha.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

      {/* Security row — explainer + passkey nudge for email signups. */}
      <Link
        href="/security"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Security</p>
          <p className="mt-0.5 text-xs text-text-soft">
            How we protect your wallet, plus what to do yourself.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

      {/* Notifications — discoverable place to enable/diagnose the
          browser-Notification ping for new pending approvals. The
          in-page prompt on the dashboard handles first-run; this is
          the always-available switch. */}
      <NotificationsSettingRow notif={notif} />

      {/* Install — surfaces the manifest-level PWA install on
          browsers that support it; renders Add-to-Home-Screen
          instructions on iOS Safari. Important on iOS specifically
          because notifications only fire once installed-as-PWA. */}
      <InstallSettingRow install={install} />

      {/* Power-user: override the Solana RPC URL. Persists in
          localStorage and takes effect on next reload. */}
      <SolanaRpcSettingRow />

      {/* Power-user: override the EVM destination RPC URL. */}
      <EvmRpcSettingRow />

      {/* Hardware-wallet power-user: pick a different Ledger
          account index when one device hosts multiple Solana
          addresses. Hidden when WebHID isn't available. */}
      <LedgerAccountSettingRow />

      {/* Network indicator */}
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-strong">Test networks</p>
          <p className="mt-0.5 text-xs text-text-soft">
            Solana devnet for the multisig, Sepolia for Ethereum. Money
            on either isn&rsquo;t real.
          </p>
        </div>
      </section>

      {/* Account actions */}
      <section className="rounded-card border border-border-soft bg-surface-raised p-2 shadow-card-rest">
        <button
          type="button"
          onClick={handleDisconnect}
          className={
            "flex w-full items-center gap-3 rounded-card px-4 py-3 text-left text-sm font-medium text-rose-600 " +
            "transition-colors duration-base ease-out-soft hover:bg-rose-500/5 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </section>

      {/* About row */}
      {/* Note: NotificationsSettingRow defined at the bottom of this
          file to keep the JSX above readable. */}
      <Link
        href="/"
        className={
          "group inline-flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface-raised px-5 py-3 text-sm shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span className="text-text-strong">What is Clear?</span>
        <ArrowRight
          className="h-4 w-4 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </motion.div>
  );
}

// ─── Notifications row ────────────────────────────────────────────

function NotificationsSettingRow({
  notif,
}: {
  notif: ReturnType<typeof useActionNotifications>;
}) {
  const Icon = notif.permission === "granted" ? Bell : BellOff;
  const title =
    notif.permission === "granted"
      ? "Notifications on"
      : notif.permission === "denied"
        ? "Notifications blocked"
        : !notif.supported
          ? "Notifications unsupported"
          : "Get notified for pending approvals";
  const body =
    notif.permission === "granted"
      ? "You'll get a browser ping when a new request needs your approval and this tab is in the background."
      : notif.permission === "denied"
        ? "Permission was blocked. Re-enable it in your browser settings, then come back here."
        : !notif.supported
          ? "This browser doesn't support browser notifications. The in-app badge still shows pending requests."
          : "A browser ping when a new request needs your approval. Only fires when this tab is in the background.";
  const showEnableButton = notif.supported && notif.permission === "default";

  return (
    <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">{title}</p>
        <p className="mt-0.5 text-xs text-text-soft">{body}</p>
      </div>
      {showEnableButton && (
        <button
          type="button"
          onClick={() => void notif.request()}
          className={
            "shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
            "transition-[background-color,transform] duration-base ease-out-soft " +
            "hover:bg-accent-hover active:scale-[0.98] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          Enable
        </button>
      )}
    </section>
  );
}

// ─── Solana RPC override ─────────────────────────────────────────

function SolanaRpcSettingRow() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Read the currently-active value from localStorage on mount so a
  // user who saved an override sees their URL pre-filled. (We can't
  // just import `solanaClusterRpc` here — that const is captured at
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
  const looksValid = /^https?:\/\/[^\s]+$/i.test(trimmed);
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Solana RPC URL
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Override the default with your own RPC (Helius, QuickNode,
            Triton). Saved on this device only.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-text-soft">
        Currently using {isUsingOverride ? "override" : "default"}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
        {effectiveUrl}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://your-rpc.example.com"
          spellCheck={false}
          className={
            "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
            "transition-[border-color,box-shadow] duration-base ease-out-soft " +
            "focus:border-accent focus:shadow-accent-rest"
          }
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasOverride || busy}
            className={
              "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
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
                "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
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
          /* swallow — connect below will surface a real error */
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
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-text-soft">
        {sessionActive
          ? `Active session: account ${sessionIndex ?? savedIndex}`
          : `Will use account ${savedIndex}`}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
        {ledgerDerivationPath(sessionIndex ?? savedIndex)}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-text-soft">
          <span className="uppercase tracking-[0.18em]">Account</span>
          <select
            value={index}
            onChange={(e) => setIndex(parseInt(e.target.value, 10))}
            className={
              "rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs font-medium text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>
                Account {i}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || busy}
          className={
            "ml-auto rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
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
  // path looks like "44'/501'/<n>'" — pull <n>.
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            EVM destination RPC URL
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Used for ETH/ERC-20 reads (balance, gas, holdings) and the
            Ika broadcast leg. Override when the public Sepolia RPC is
            rate-limited.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-text-soft">
        Currently using {isUsingOverride ? "override" : "default"}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
        {effectiveUrl}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://your-evm-rpc.example.com"
          spellCheck={false}
          className={
            "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
            "transition-[border-color,box-shadow] duration-base ease-out-soft " +
            "focus:border-accent focus:shadow-accent-rest"
          }
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasOverride || busy}
            className={
              "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
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
                "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
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

// ─── Install row ─────────────────────────────────────────────────

function InstallSettingRow({
  install,
}: {
  install: ReturnType<typeof useInstallPrompt>;
}) {
  // Hide entirely when there's no install path (already installed,
  // or unsupported browser/context). No row beats a row that says
  // "you can't install" — saves vertical space.
  if (install.status === "installed" || install.status === "unsupported") {
    return null;
  }
  if (install.status === "manual") {
    // iOS Safari path. There's no API to fire the share sheet
    // programmatically, so we render the standard instruction
    // pattern with the right icon to match what's on the user's
    // toolbar.
    return (
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Download className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Install Clear on this device
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Tap the{" "}
            <Share2 className="-mt-0.5 inline h-3.5 w-3.5" aria-hidden="true" />{" "}
            Share button in Safari, then{" "}
            <span className="font-medium text-text-strong">
              Add to Home Screen
            </span>
            . Notifications work once installed.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Download className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">
          Install Clear on this device
        </p>
        <p className="mt-0.5 text-xs text-text-soft">
          Adds a launcher icon and runs in its own window — quicker than
          finding the tab.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void install.prompt()}
        className={
          "shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
          "transition-[background-color,transform] duration-base ease-out-soft " +
          "hover:bg-accent-hover active:scale-[0.98] " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        }
      >
        Install
      </button>
    </section>
  );
}
