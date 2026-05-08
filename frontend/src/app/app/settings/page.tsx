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
  Mail,
  Share2,
  ShieldCheck,
  Webhook,
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
  clearPin,
  getAppLockState,
  lockNow,
  setPin as setAppLockPin,
  verifyPin,
} from "@/lib/security/appLock";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import {
  getStoredTheme,
  setStoredTheme,
  type ThemeMode,
} from "@/lib/security/theme";
import {
  getAddressFormat,
  setAddressFormat,
  type AddressFormatMode,
} from "@/lib/security/addressFormat";
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
import {
  isValidEmailAddress,
  loadEmailPrefs,
  saveEmailPrefs,
  type EmailNotificationPrefs,
} from "@/lib/security/emailNotifications";
import {
  ALL_EVENT_TYPES,
  emptyWebhookPrefs,
  eventTypeLabel,
  fireTestWebhook,
  isValidWebhookUrl,
  loadWebhookPrefs,
  saveWebhookPrefs,
  type WebhookEventType,
  type WebhookPrefs,
} from "@/lib/security/webhookNotifications";

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

      {/* Theme — light / dark / system. Stored per-device in
          localStorage; an inline script in app/layout.tsx applies
          it before first paint to avoid the light-mode flash. */}
      <ThemeSettingRow />

      {/* Address display — abbreviated / full / EIP-55 checksum.
          Applied through shortEvmAddress + shortAddress so every
          existing call site picks it up automatically. */}
      <AddressFormatRow />

      {/* App lock — per-device PIN that gates /app/* on every fresh
          tab. Stored locally only; we never see the PIN. Useful on
          shared / unlocked devices where Dynamic's session token
          would otherwise let anyone open balances + sign flows. */}
      <AppLockSettingRow />

      {/* Sign-in security — opens Dynamic's user-profile modal so
          embedded-wallet users can enroll passkeys / change email /
          revoke devices without us baking that flow ourselves.
          External-wallet users (Phantom, Ledger) skip the modal —
          their auth is managed by the wallet itself. */}
      <SignInSecurityRow />

      {/* Notifications — discoverable place to enable/diagnose the
          browser-Notification ping for new pending approvals. The
          in-page prompt on the dashboard handles first-run; this is
          the always-available switch. */}
      <NotificationsSettingRow notif={notif} />

      {/* Email-on-pending — opt-in email when a new approval lands
          and the tab is in the background. Fires from the browser
          (no server-side cron yet), so it only sends while the app
          is loaded somewhere. */}
      <EmailNotificationsSettingRow />

      {/* Webhooks — POST events to a user-supplied URL so treasury
          teams can pipe Clear into Slack / Discord / PagerDuty /
          Zapier without us shipping per-tool integrations. */}
      <WebhooksSettingRow />

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

      {/* What's new — in-app changelog. Discoverable from Settings
          so users notice the new affordances they might otherwise
          miss on familiar surfaces. */}
      <Link
        href="/changelog"
        className={
          "group inline-flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface-raised px-5 py-3 text-sm shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span className="text-text-strong">What&rsquo;s new</span>
        <ArrowRight
          className="h-4 w-4 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

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

// ─── Email notifications row ────────────────────────────────────

function EmailNotificationsSettingRow() {
  // localStorage-backed prefs. Mount-only read — saves are pushed
  // through saveEmailPrefs immediately so cross-tab pickup works on
  // next render of the consumer (useActionNotifications re-reads on
  // each fire).
  const [prefs, setPrefs] = useState<EmailNotificationPrefs | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const p = loadEmailPrefs();
    setPrefs(p);
    setDraft(p.email);
  }, []);

  if (!prefs) {
    // Pre-hydration on the server / first paint. Render the same
    // shell so the layout doesn't flicker.
    return (
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mail className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Email me about pending approvals
          </p>
          <p className="mt-0.5 text-xs text-text-soft">Loading…</p>
        </div>
      </section>
    );
  }

  const trimmed = draft.trim();
  const valid = isValidEmailAddress(trimmed);
  const hasEmail = prefs.email.trim().length > 0;

  const setEnabled = (enabled: boolean) => {
    const next: EmailNotificationPrefs = { ...prefs, enabled };
    setPrefs(next);
    saveEmailPrefs(next);
  };
  const saveEmail = () => {
    if (!valid) return;
    const next: EmailNotificationPrefs = {
      ...prefs,
      email: trimmed,
      // Auto-enable on first save — there's no point asking the user
      // to type their email then flip a separate toggle.
      enabled: true,
    };
    setPrefs(next);
    saveEmailPrefs(next);
    setEditing(false);
  };
  const removeEmail = () => {
    const next: EmailNotificationPrefs = {
      ...prefs,
      email: "",
      enabled: false,
    };
    setPrefs(next);
    saveEmailPrefs(next);
    setDraft("");
    setEditing(false);
  };

  const title = hasEmail
    ? prefs.enabled
      ? "Emails on"
      : "Emails paused"
    : "Email me about pending approvals";
  const body = hasEmail
    ? prefs.enabled
      ? `Sending to ${prefs.email}. One per minute, only when this tab is in the background.`
      : `Saved as ${prefs.email}. Toggle back on to resume.`
    : "Get an email when a new approval lands and you're not on the page. Only fires while Clear is loaded somewhere.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Mail className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">{title}</p>
          <p className="mt-0.5 text-xs text-text-soft">{body}</p>
        </div>
        {hasEmail && (
          <button
            type="button"
            onClick={() => setEnabled(!prefs.enabled)}
            aria-pressed={prefs.enabled}
            className={
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
              (prefs.enabled
                ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
                : "bg-accent text-white hover:bg-accent-hover")
            }
          >
            {prefs.enabled ? "Pause" : "Resume"}
          </button>
        )}
      </div>

      {(editing || !hasEmail) ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="you@example.com"
            spellCheck={false}
            autoComplete="email"
            className={
              "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={saveEmail}
              disabled={!valid}
              className={
                "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              Save
            </button>
            {hasEmail && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(prefs.email);
                }}
                className="rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft hover:border-accent hover:text-accent"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft hover:border-accent hover:text-accent"
          >
            Change email
          </button>
          <button
            type="button"
            onClick={removeEmail}
            className="rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft hover:border-rose-500 hover:text-rose-600"
          >
            Remove
          </button>
        </div>
      )}
      {trimmed.length > 0 && !valid && (
        <p className="mt-2 text-xs text-warning">
          That doesn&rsquo;t look like a valid email address.
        </p>
      )}
    </section>
  );
}

// ─── Webhook notifications row ──────────────────────────────────

function WebhooksSettingRow() {
  const [prefs, setPrefs] = useState<WebhookPrefs | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftSecret, setDraftSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok" }
    | { status: "fail" }
  >({ status: "idle" });

  useEffect(() => {
    const p = loadWebhookPrefs();
    setPrefs(p);
    setDraftUrl(p.url);
    setDraftSecret(p.secret);
  }, []);

  if (!prefs) {
    return (
      <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Webhook className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Webhook</p>
          <p className="mt-0.5 text-xs text-text-soft">Loading…</p>
        </div>
      </section>
    );
  }

  const trimmedUrl = draftUrl.trim();
  const validUrl = isValidWebhookUrl(trimmedUrl);
  const hasUrl = isValidWebhookUrl(prefs.url);

  const setEnabled = (enabled: boolean) => {
    const next: WebhookPrefs = { ...prefs, enabled };
    setPrefs(next);
    saveWebhookPrefs(next);
  };

  const toggleEvent = (event: WebhookEventType) => {
    const has = prefs.events.includes(event);
    const events = has
      ? prefs.events.filter((e) => e !== event)
      : [...prefs.events, event];
    const next: WebhookPrefs = { ...prefs, events };
    setPrefs(next);
    saveWebhookPrefs(next);
  };

  const saveUrl = () => {
    if (!validUrl) return;
    const next: WebhookPrefs = {
      ...prefs,
      url: trimmedUrl,
      secret: draftSecret,
      enabled: true,
    };
    setPrefs(next);
    saveWebhookPrefs(next);
    setEditing(false);
    setTest({ status: "idle" });
  };
  const removeUrl = () => {
    const next = emptyWebhookPrefs();
    setPrefs(next);
    saveWebhookPrefs(next);
    setDraftUrl("");
    setDraftSecret("");
    setEditing(false);
    setTest({ status: "idle" });
  };

  const runTest = async () => {
    setTest({ status: "running" });
    const ok = await fireTestWebhook();
    setTest({ status: ok ? "ok" : "fail" });
  };

  const title = hasUrl
    ? prefs.enabled
      ? "Webhook on"
      : "Webhook paused"
    : "Pipe events into your ops tools";
  const body = hasUrl
    ? prefs.enabled
      ? `Posting to ${shortenUrl(prefs.url)} on ${prefs.events.length} event ${prefs.events.length === 1 ? "type" : "types"}.`
      : `Saved as ${shortenUrl(prefs.url)}. Toggle back on to resume.`
    : "POST a JSON payload to your Slack / Discord / Zapier / PagerDuty hook for new pending approvals, executes, and failures. Only fires while Clear is loaded.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Webhook className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">{title}</p>
          <p className="mt-0.5 text-xs text-text-soft">{body}</p>
        </div>
        {hasUrl && (
          <button
            type="button"
            onClick={() => setEnabled(!prefs.enabled)}
            aria-pressed={prefs.enabled}
            className={
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
              (prefs.enabled
                ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
                : "bg-accent text-white hover:bg-accent-hover")
            }
          >
            {prefs.enabled ? "Pause" : "Resume"}
          </button>
        )}
      </div>

      {(editing || !hasUrl) ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="url"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            spellCheck={false}
            autoComplete="off"
            className={
              "rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <input
            type="text"
            value={draftSecret}
            onChange={(e) => setDraftSecret(e.target.value)}
            placeholder="Optional: shared secret for HMAC-SHA256 signature"
            spellCheck={false}
            autoComplete="off"
            className={
              "rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-xs text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <p className="text-[11px] text-text-soft">
            Receivers verify the <code className="font-mono">X-Clear-Signature</code>{" "}
            header by recomputing HMAC-SHA256 over the raw body using this secret.
            Leave empty to skip signing.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveUrl}
              disabled={!validUrl}
              className={
                "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              Save
            </button>
            {hasUrl && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftUrl(prefs.url);
                  setDraftSecret(prefs.secret);
                }}
                className="rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft hover:border-accent hover:text-accent"
              >
                Cancel
              </button>
            )}
          </div>
          {trimmedUrl.length > 0 && !validUrl && (
            <p className="text-xs text-warning">
              Must be a valid http(s) URL.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ALL_EVENT_TYPES.map((ev) => {
              const active = prefs.events.includes(ev);
              return (
                <button
                  key={ev}
                  type="button"
                  onClick={() => toggleEvent(ev)}
                  className={
                    "rounded-soft border px-3 py-2 text-left text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                    (active
                      ? "border-accent bg-accent/[0.08] text-text-strong"
                      : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{eventTypeLabel(ev)}</span>
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={test.status === "running"}
              className={
                "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium transition-colors duration-base ease-out-soft " +
                (test.status === "ok"
                  ? "border-accent text-accent"
                  : test.status === "fail"
                    ? "border-warning text-warning"
                    : "text-text-soft hover:border-accent hover:text-accent") +
                " disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {test.status === "running"
                ? "Sending…"
                : test.status === "ok"
                  ? "Test sent ✓"
                  : test.status === "fail"
                    ? "Test failed"
                    : "Send test"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft hover:border-accent hover:text-accent"
            >
              Change URL
            </button>
            <button
              type="button"
              onClick={removeUrl}
              className="rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft hover:border-rose-500 hover:text-rose-600"
            >
              Remove
            </button>
          </div>
          {test.status === "fail" && (
            <p className="mt-2 text-xs text-warning">
              The test POST didn&rsquo;t come back 2xx. Common causes: CORS isn&rsquo;t
              allowed by your destination, the URL changed, or the endpoint
              expects a different body format.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host + (url.pathname.length > 1 ? url.pathname : "");
  } catch {
    return u;
  }
}

// ─── Address display format ─────────────────────────────────────

function AddressFormatRow() {
  const [mode, setMode] = useState<AddressFormatMode>("abbreviated");
  useEffect(() => {
    setMode(getAddressFormat());
  }, []);
  const set = (next: AddressFormatMode) => {
    setMode(next);
    setAddressFormat(next);
    // Force a re-render of the rest of the app so addresses pick
    // up the new mode without requiring a navigate. The Settings
    // row itself reflects the change immediately; everything else
    // sees the new value on its next render. A localStorage event
    // doesn't fire in the same tab, so dispatch one ourselves so
    // any code subscribed to address-format changes can react.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("clear:address-format-changed"));
    }
  };
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Contact className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Address display
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            How EVM + Solana addresses look in the UI. EIP-55 mixed-case
            applies to EVM only (Solana base58 has no case form).
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["abbreviated", "checksum", "full"] as AddressFormatMode[]).map(
          (opt) => {
            const active = mode === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => set(opt)}
                className={
                  "rounded-soft border px-3 py-2 text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                  (active
                    ? "border-accent bg-accent/[0.08] text-text-strong"
                    : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
                }
              >
                {opt === "abbreviated"
                  ? "Abbreviated"
                  : opt === "checksum"
                    ? "EIP-55"
                    : "Full"}
              </button>
            );
          },
        )}
      </div>
    </section>
  );
}

// ─── Theme (light / dark / system) ──────────────────────────────

function ThemeSettingRow() {
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => {
    setMode(getStoredTheme());
  }, []);
  const set = (next: ThemeMode) => {
    setMode(next);
    setStoredTheme(next);
  };
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Theme</p>
          <p className="mt-0.5 text-xs text-text-soft">
            Light, dark, or follow your OS. Saved on this device.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["light", "system", "dark"] as ThemeMode[]).map((opt) => {
          const active = mode === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => set(opt)}
              className={
                "rounded-soft border px-3 py-2 text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                (active
                  ? "border-accent bg-accent/[0.08] text-text-strong"
                  : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
              }
            >
              {opt === "light"
                ? "Light"
                : opt === "dark"
                  ? "Dark"
                  : "System"}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Sign-in security (Dynamic user profile) ─────────────────────

function SignInSecurityRow() {
  const { setShowDynamicUserProfile, user, primaryWallet } = useDynamicContext();
  // External wallets (Phantom / Solflare / Backpack / Ledger) carry
  // their own auth — Dynamic isn't where their passkey lives. We
  // tell users that explicitly so the row doesn't read as
  // "passkey unavailable" when actually they already have a
  // hardware-grade signer. Same duck-type the rest of the codebase
  // uses (lib/wallet/index.ts::signerIssue) — `key` carries the
  // connector identifier at runtime, embedded variants are
  // "dynamicwaas" / "turnkey", external is everything else.
  const c = (primaryWallet as unknown as {
    connector?: { key?: string; name?: string; overrideKey?: string };
  })?.connector;
  const id = (c?.key ?? c?.overrideKey ?? c?.name ?? "").toLowerCase();
  const isEmbedded = /dynamicwaas|turnkey/.test(id);
  const isExternal = !!primaryWallet && !isEmbedded;
  const hasDynamicAccount = !!user;

  return (
    <section className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">
          Sign-in security
        </p>
        <p className="mt-0.5 text-xs text-text-soft">
          {isExternal
            ? "Connected via an external wallet — passkey / hardware-key auth is managed by that wallet, not Clear."
            : hasDynamicAccount
              ? "Manage passkey, email, and device list. Passkey beats email-link sign-in for both speed and security."
              : "Connect first; sign-in options become available after."}
        </p>
      </div>
      {!isExternal && hasDynamicAccount && (
        <button
          type="button"
          onClick={() => setShowDynamicUserProfile(true)}
          className={
            "shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
            "transition-[background-color,transform] duration-base ease-out-soft " +
            "hover:bg-accent-hover active:scale-[0.98] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          Manage
        </button>
      )}
    </section>
  );
}

// ─── App lock (PIN) ──────────────────────────────────────────────

function AppLockSettingRow() {
  // Re-read on every mount + after each save/clear so the row
  // reflects the actual stored state. AppLockOverlay also reads
  // from the same source of truth — no shared state needed.
  const [hasPin, setHasPin] = useState(false);
  const [editing, setEditing] = useState<
    "set" | "change" | "disable" | null
  >(null);
  const refresh = () => setHasPin(getAppLockState().hasPin);
  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            App lock {hasPin ? "(on)" : "(off)"}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Ask for a PIN before showing wallets on this device. Stored
            on this device only — we never see your PIN.
          </p>
        </div>
        {hasPin ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(editing === "change" ? null : "change")}
              className={
                "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent"
              }
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => setEditing(editing === "disable" ? null : "disable")}
              className={
                "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:border-rose-500 hover:text-rose-600"
              }
            >
              Disable
            </button>
            <button
              type="button"
              onClick={() => {
                lockNow();
                window.location.reload();
              }}
              title="Lock this tab now and require the PIN to continue"
              className={
                "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
                "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98]"
              }
            >
              Lock now
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(editing === "set" ? null : "set")}
            className={
              "shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
              "transition-[background-color,transform] duration-base ease-out-soft " +
              "hover:bg-accent-hover active:scale-[0.98] " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            Set PIN
          </button>
        )}
      </div>
      {editing === "set" && (
        <PinForm
          mode="set"
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
      {editing === "change" && (
        <PinForm
          mode="change"
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
      {editing === "disable" && (
        <PinForm
          mode="disable"
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function PinForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: "set" | "change" | "disable";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "change" || mode === "disable") {
        const ok = await verifyPin(current);
        if (!ok) {
          setErr("Current PIN is wrong");
          return;
        }
      }
      if (mode === "disable") {
        clearPin();
        onSaved();
        return;
      }
      if (next.length < 4 || next.length > 8 || !/^\d+$/.test(next)) {
        setErr("New PIN must be 4–8 digits");
        return;
      }
      if (next !== confirm) {
        setErr("New PIN doesn't match the confirmation");
        return;
      }
      await setAppLockPin(next);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save PIN");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="mt-4 flex flex-col gap-2 rounded-soft border border-border-soft bg-canvas p-3"
    >
      {(mode === "change" || mode === "disable") && (
        <PinInput
          label="Current PIN"
          value={current}
          onChange={setCurrent}
          autoFocus
        />
      )}
      {mode !== "disable" && (
        <>
          <PinInput
            label={mode === "change" ? "New PIN" : "New PIN (4–8 digits)"}
            value={next}
            onChange={setNext}
            autoFocus={mode === "set"}
          />
          <PinInput
            label="Confirm new PIN"
            value={confirm}
            onChange={setConfirm}
          />
        </>
      )}
      {err && (
        <p className="text-[11px] text-warning" role="alert">
          {err}
        </p>
      )}
      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-text-soft hover:text-text-strong"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className={
            "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
            "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
            "disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {busy
            ? "Saving…"
            : mode === "set"
              ? "Set PIN"
              : mode === "change"
                ? "Change PIN"
                : "Disable PIN"}
        </button>
      </div>
    </form>
  );
}

function PinInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="min-w-[110px] shrink-0 text-[11px] uppercase tracking-[0.18em] text-text-soft">
        {label}
      </span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
        autoFocus={autoFocus}
        className={
          "min-w-0 flex-1 rounded-soft border border-border-soft bg-surface-raised px-2.5 py-1.5 text-sm tracking-[0.4em] text-text-strong outline-none " +
          "transition-[border-color,box-shadow] duration-base ease-out-soft " +
          "focus:border-accent focus:shadow-accent-rest"
        }
      />
    </label>
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
