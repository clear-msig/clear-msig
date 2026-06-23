"use client";

// Settings - minimal retail account screen.
//
// What a non-technical user needs from a settings surface:
//   - Confirmation they're connected, with a copyable identity.
//   - Which network ("Test network" - the preview banner says the
//     same, this is a quieter restatement).
//   - A clear way to sign out.
//
// Everything else (chain switching, RPC URL, intent template editor,
// raw address display) is a power-user concern. Out of scope here.

import { useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  Coins,
  Download,
  ExternalLink,
  Hash,
  Lock,
  Mail,
  MailX,
  Monitor,
  Moon,
  Share2,
  ShieldCheck,
  Sun,
  Webhook,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { BrandSelect } from "@/components/retail/BrandSelect";
import { InfoTip } from "@/components/retail/InfoTip";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import { useInstallPrompt } from "@/lib/hooks/useInstallPrompt";
import {
  RPC_OVERRIDE_STORAGE_KEY,
  solanaClusterDefaultRpc,
  solanaClusterRpc,
} from "@/lib/solana/cluster";
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
import {
  ALL_DISPLAY_CURRENCIES,
  currencyLabel,
  currencySymbol,
  getDisplayCurrency,
  setDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/retail/priceConversion";

export default function SettingsPage() {
  const reduce = useReducedMotion();
  const notif = useActionNotifications();
  const install = useInstallPrompt();

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
      {/* Compact header. Identity, app lock, sign-in security, and
          sign-out have all moved to /app/account so this page can
          stay focused on app-level preferences (display, notifications,
          privacy info, advanced, about). */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-1">
          <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
            Settings
          </h1>
          <p className="text-xs text-text-soft sm:text-sm">
            App preferences, notifications, and advanced controls.
          </p>
        </div>
      </header>

      {/* Sticky section-jump nav. Active pill is driven by an
          IntersectionObserver watching each Group section; clicking
          a pill scrolls the matching section into view (`scroll-mt-20`
          on Group provides the offset so the section title isn't
          hidden under the nav). */}
      <SettingsNav />


      {/* ── Privacy & security ──────────────────────────────── */}
      {/* Identity, app-lock PIN, and sign-in management have moved
          to /app/account. Settings keeps only the public-facing
          privacy/security explainer links. */}
      <Group id="privacy" label="Privacy & security">
      <Link
        href="/privacy"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:shadow-card-raised " +
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

      <Link
        href="/security"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:shadow-card-raised " +
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

      <Link
        href="/app/security-architecture"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Hash className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">Security architecture</p>
          <p className="mt-0.5 text-xs text-text-soft">
            Browser proposes. Backend verifies. Chain enforces.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
      </Group>

      {/* ── Display ─────────────────────────────────────────── */}
      <Group id="display" label="Display">
      {/* Theme - light / dark / system. Stored per-device in
          localStorage; an inline script in app/layout.tsx applies
          it before first paint to avoid the light-mode flash. */}
      <ThemeSettingRow />

      {/* Address display - abbreviated / full / EIP-55 checksum.
          Applied through shortEvmAddress + shortAddress so every
          existing call site picks it up automatically. */}
      <AddressFormatRow />

      {/* Display currency - display-only pref. Internal math (budget
          caps, policy thresholds) stays USD-pinned because that's
          where the on-chain rules are denominated. */}
      <DisplayCurrencyRow />

      </Group>

      {/* ── Notifications ────────────────────────────────────── */}
      <Group id="notifications" label="Notifications">
      {/* Browser-Notification ping for new pending approvals. The
          in-page prompt on the dashboard handles first-run; this is
          the always-available switch. */}
      <NotificationsSettingRow notif={notif} />

      {/* Email-on-pending - opt-in email when a new approval lands
          and the tab is in the background. Fires from the browser
          (no server-side cron yet), so it only sends while the app
          is loaded somewhere. */}
      <EmailNotificationsSettingRow />

      {/* Webhooks - POST events to a user-supplied URL so treasury
          teams can pipe Clear into Slack / Discord / PagerDuty /
          Zapier without us shipping per-tool integrations. */}
      <WebhooksSettingRow />

      {/* Sent invitations - audit log of email invites this device
          dispatched, with a withdrawal email for mistakes. */}
      <Link
        href="/app/invitations"
        className={
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <MailX className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Sent invitations
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Email invites you&rsquo;ve sent. Withdraw the ones that were a mistake.
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>

      </Group>

      {/* ── Advanced ───────────────────────────────────────── */}
      <Group id="advanced" label="Advanced">
      {/* Network indicator - hoisted from the old Connection group
          since it's a network setting and lives next to the RPC
          overrides. Single info card, no interaction. */}
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

      {/* PWA install on supported browsers; iOS Safari instructions
          otherwise. Important on iOS specifically because
          notifications only fire once installed-as-PWA. */}
      <InstallSettingRow install={install} />

      {/* Override the Solana RPC URL. Persists in localStorage,
          takes effect on next reload. */}
      <SolanaRpcSettingRow />

      {/* Override the EVM destination RPC URL. */}
      <EvmRpcSettingRow />

      {/* Pick a different Ledger account index when one device
          hosts multiple Solana addresses. Hidden when WebHID
          isn't available. */}
      <LedgerAccountSettingRow />
      </Group>

      {/* ── About ──────────────────────────────────────────── */}
      <Group
        id="about"
        label="About"
        description="What's new and the elevator pitch."
      >
        <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
          <li>
            <Link
              href="/changelog"
              className={clsx(
                "group flex items-center justify-between gap-3 px-5 py-3.5",
                "transition-colors duration-base ease-out-soft hover:bg-canvas",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
              )}
            >
              <span className="text-sm font-medium text-text-strong">
                What&rsquo;s new
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>
          </li>
          <li>
            <Link
              href="/"
              className={clsx(
                "group flex items-center justify-between gap-3 px-5 py-3.5",
                "transition-colors duration-base ease-out-soft hover:bg-canvas",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
              )}
            >
              <span className="text-sm font-medium text-text-strong">
                What is Clear?
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>
          </li>
        </ul>
      </Group>

      {/* Sign-out lives on /app/account now. Pointer-link here so a
          user who's expecting it on Settings (the old home of the
          control) can still find their way. */}
      <Link
        href="/app/account"
        className={clsx(
          "group inline-flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface-raised px-5 py-3.5 shadow-card-rest",
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft",
          "hover:-translate-y-0.5 hover:shadow-card-raised",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text-strong">
            Looking for sign-out?
          </span>
          <span className="mt-0.5 text-xs text-text-soft">
            Identity, app lock, and sign-out moved to your Account page.
          </span>
        </span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </motion.div>
  );
}

// ─── Group wrapper ─────────────────────────────────────────────
//
// Settings used to be 18 identically-styled cards stacked
// vertically - a wall to scan. Group wraps each thematic cluster
// with a small uppercase label + a tighter inner gap so the page
// reads as ~7 short clusters rather than one long list.
//
// `id` powers the section-jump anchors driven by SettingsNav;
// `scroll-mt-20` (5rem) offsets the smooth scroll so the section
// title isn't hidden under the sticky nav.

function Group({
  id,
  label,
  description,
  children,
}: {
  id?: string;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      // scroll-mt-32 (8rem) clears the mobile backdrop (56px) + nav
      // (~50px) + breathing room when scrolled to via anchor jump.
      // Desktop only needs to clear the nav itself, so md:scroll-mt-24.
      className="flex scroll-mt-32 flex-col gap-3 md:scroll-mt-24"
      data-section-anchor={id || undefined}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          {label}
        </h2>
        {description ? (
          <p className="text-xs text-text-soft/80">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ─── Section nav ────────────────────────────────────────────────
//
// Sticky horizontal pill bar that lets users jump to a section
// without scrolling through the full page. The active pill is
// driven by an IntersectionObserver - whichever section is
// closest to the top (within the strip set by rootMargin) wins.
//
// Mobile: pills scroll horizontally. The active pill auto-scrolls
// into view so the user always sees where they are.
// Desktop: pills fit on one line for typical max-w-[80rem].

const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: "privacy", label: "Privacy" },
  { id: "display", label: "Display" },
  { id: "notifications", label: "Notifications" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
];

function SettingsNav() {
  const [activeId, setActiveId] = useState<string>(NAV_SECTIONS[0].id);

  // Watch each Group section. As the user scrolls, whichever
  // section is intersecting the top-third strip wins. The negative
  // bottom rootMargin shrinks the active zone to just the top of
  // the viewport so we don't flicker between two visible sections.
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Pick the first section in the canonical order that's
        // currently in the active zone - gives stable upward
        // progression as the user scrolls.
        const ordered = NAV_SECTIONS.map((s) => s.id);
        const next = ordered.find((id) => visible.has(id));
        if (next) setActiveId(next);
      },
      {
        rootMargin: "-72px 0px -55% 0px",
        threshold: 0,
      },
    );
    NAV_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const handleJump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  };

  return (
    <nav
      role="tablist"
      aria-label="Settings sections"
      className={clsx(
        // top-16 on mobile clears the fixed mobile-backdrop (h-16)
        // that sits above the body scroll, so the nav sticks directly
        // below the floating header pill. Desktop has no backdrop -
        // the parent scroll container starts directly below the
        // DashboardHeader, so md:top-0 sticks the nav flush against
        // the header bottom (no gap, no double-line).
        "sticky top-16 z-10 -mx-3 md:top-0 sm:-mx-4 md:-mx-8 lg:-mx-10 xl:-mx-12",
        "border-b border-border-soft bg-canvas",
        // Soft downward shadow gives the nav a stronger "stuck" cue
        // on mobile (the pill above + the nav below need to read as
        // distinct chrome layers, not one merged blur).
        "shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)]",
      )}
    >
      <div
        className={clsx(
          "flex items-center gap-1.5 overflow-x-auto px-3 py-2.5 sm:px-4 md:px-8 lg:px-10 xl:px-12",
          // Hide the scrollbar visually - the horizontal scroll is
          // there as a fallback for narrow viewports, but a permanent
          // scrollbar reads as clutter inside what's effectively chrome.
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {NAV_SECTIONS.map((s) => {
          const active = activeId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleJump(s.id)}
              className={clsx(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
                "transition-colors duration-base ease-out-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-soft hover:bg-glass-soft hover:text-text-strong",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </nav>
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
            "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
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
  // localStorage-backed prefs. Mount-only read - saves are pushed
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
      // Auto-enable on first save - there's no point asking the user
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
              "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full px-4 py-2 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
              (prefs.enabled
                ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
                : "bg-accent text-text-on-accent hover:bg-accent-hover")
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
                "inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
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
                className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
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
            className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
          >
            Change email
          </button>
          <button
            type="button"
            onClick={removeEmail}
            className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:border-rose-500 hover:text-rose-600"
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
              "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full px-4 py-2 text-xs font-medium transition-[background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
              (prefs.enabled
                ? "border border-border-soft bg-canvas text-text-soft hover:border-rose-500 hover:text-rose-600"
                : "bg-accent text-text-on-accent hover:bg-accent-hover")
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
                "inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
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
                className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
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
                      : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
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
                "inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium transition-colors duration-base ease-out-soft " +
                (test.status === "ok"
                  ? "border-accent text-accent"
                  : test.status === "fail"
                    ? "border-warning text-warning"
                    : "text-text-soft hover:text-accent") +
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
              className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:text-accent"
            >
              Change URL
            </button>
            <button
              type="button"
              onClick={removeUrl}
              className="inline-flex min-h-tap items-center justify-center rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft hover:border-rose-500 hover:text-rose-600"
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
          <Hash className="h-5 w-5" strokeWidth={1.75} />
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
                    : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
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

// ─── Display currency ───────────────────────────────────────────

function DisplayCurrencyRow() {
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");
  useEffect(() => {
    setCurrency(getDisplayCurrency());
  }, []);
  const set = (next: DisplayCurrency) => {
    setCurrency(next);
    setDisplayCurrency(next);
  };
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Coins className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Display currency
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Wallet totals render in this fiat. Budget caps and policy
            thresholds stay set in USD - that&rsquo;s the unit on chain.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ALL_DISPLAY_CURRENCIES.map((opt) => {
          const active = currency === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => set(opt)}
              title={currencyLabel(opt)}
              className={
                "rounded-soft border px-3 py-2 text-center text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                (active
                  ? "border-accent bg-accent/[0.08] text-text-strong"
                  : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
              }
            >
              <span className="text-base font-semibold">
                {currencySymbol(opt)}
              </span>{" "}
              {opt}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-text-soft">
        Demo FX rates today. The live oracle that ships with the price
        feeds workstream replaces both the spot prices and these rates
        in one swap.
      </p>
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
    <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
      {/* Header strip - mono eyebrow + display title, the same
          pattern the workspace pages use. The icon disc reflects
          the active mode so the card itself previews the choice. */}
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"
        >
          {mode === "light" ? (
            <Sun className="h-5 w-5" strokeWidth={1.75} />
          ) : mode === "dark" ? (
            <Moon className="h-5 w-5" strokeWidth={1.75} />
          ) : (
            <Monitor className="h-5 w-5" strokeWidth={1.75} />
          )}
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Appearance
          </p>
          <p className="mt-1 font-display text-lg leading-tight text-text-strong">
            Theme
          </p>
        </div>
      </header>

      {/* Three big preview tiles - each shows a tiny mockup of a
          card surface in that mode (sky band + card with content +
          accent dot). The active tile gets the accent ring + a
          check badge in its corner so the choice reads at a
          glance. Tiles are tap-targets ≥80px tall on mobile. */}
      <div role="radiogroup" aria-label="Theme" className="mt-5 grid grid-cols-3 gap-3">
        <ThemeTile
          id="light"
          label="Light"
          Icon={Sun}
          active={mode === "light"}
          onSelect={set}
          preview={
            <div className="h-full w-full rounded-[6px] bg-[#f6f7f9] p-1.5">
              <div className="h-1 w-3/4 rounded-full bg-[#0a0e16]/15" />
              <div className="mt-1 flex items-center gap-1 rounded-[4px] bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#4d7c0f]" />
                <div className="h-0.5 flex-1 rounded-full bg-[#0a0e16]/25" />
              </div>
              <div className="mt-1 h-0.5 w-1/2 rounded-full bg-[#0a0e16]/15" />
            </div>
          }
        />
        <ThemeTile
          id="system"
          label="System"
          Icon={Monitor}
          active={mode === "system"}
          onSelect={set}
          preview={
            <div className="grid h-full w-full grid-cols-2 overflow-hidden rounded-[6px]">
              <div className="bg-[#f6f7f9] p-1.5">
                <div className="h-1 w-3/4 rounded-full bg-[#0a0e16]/15" />
                <div className="mt-1 h-1 w-1/2 rounded-full bg-[#4d7c0f]" />
              </div>
              <div className="bg-[#0a0a0a] p-1.5">
                <div className="h-1 w-3/4 rounded-full bg-white/15" />
                <div className="mt-1 h-1 w-1/2 rounded-full bg-[#ccff00]" />
              </div>
            </div>
          }
        />
        <ThemeTile
          id="dark"
          label="Dark"
          Icon={Moon}
          active={mode === "dark"}
          onSelect={set}
          preview={
            <div className="h-full w-full rounded-[6px] bg-[#0a0a0a] p-1.5">
              <div className="h-1 w-3/4 rounded-full bg-white/15" />
              <div className="mt-1 flex items-center gap-1 rounded-[4px] bg-[#131316] p-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00]" />
                <div className="h-0.5 flex-1 rounded-full bg-white/25" />
              </div>
              <div className="mt-1 h-0.5 w-1/2 rounded-full bg-white/15" />
            </div>
          }
        />
      </div>

      <p className="mt-4 text-[11px] text-text-soft">
        Saved on this device. Changes fade in over ~220ms.
      </p>
    </section>
  );
}

function ThemeTile({
  id,
  label,
  Icon,
  active,
  onSelect,
  preview,
}: {
  id: ThemeMode;
  label: string;
  Icon: typeof Sun;
  active: boolean;
  onSelect: (m: ThemeMode) => void;
  preview: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(id)}
      className={clsx(
        "group relative flex flex-col items-stretch gap-2 rounded-card border bg-canvas p-2.5 text-left",
        "transition-[border-color,background-color,transform,box-shadow] duration-base ease-out-soft",
        "hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        active
          ? "border-accent shadow-accent-rest"
          : "border-border-soft hover:border-border-strong",
      )}
    >
      {/* Mini preview swatch - aspect-square keeps the proportions
          tidy across the 3-up grid regardless of column width. */}
      <div className="relative aspect-square w-full overflow-hidden rounded-soft border border-border-soft/40">
        {preview}
        {active && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-sm"
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <span
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 text-[11px] font-medium",
          active ? "text-text-strong" : "text-text-soft group-hover:text-text-strong",
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {label}
      </span>
    </button>
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

// ─── Install row ─────────────────────────────────────────────────

function InstallSettingRow({
  install,
}: {
  install: ReturnType<typeof useInstallPrompt>;
}) {
  // Hide entirely when there's no install path (already installed,
  // or unsupported browser/context). No row beats a row that says
  // "you can't install" - saves vertical space.
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
          Adds a launcher icon and runs in its own window - quicker than
          finding the tab.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void install.prompt()}
        className={
          "shrink-0 inline-flex min-h-tap items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent " +
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
