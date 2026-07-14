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
  Download,
  ExternalLink,
  Hash,
  Lock,
  MailX,
  Share2,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { InfoTip } from "@/components/retail/InfoTip";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import { useInstallPrompt } from "@/lib/hooks/useInstallPrompt";
import { AdvancedSettingsControls } from "@/features/settings/ui/AdvancedSettingsControls";
import { DisplaySettingsControls } from "@/features/settings/ui/DisplaySettingsControls";
import {
  NotificationSettingsControls,
  WebhookSettingsControl,
} from "@/features/settings/ui/NotificationSettingsControls";

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
            How ClearSig keeps personal wallet details quiet and controlled.
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
            A plain-English view of how ClearSig checks actions before money moves.
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
      <DisplaySettingsControls />

      </Group>

      {/* ── Notifications ────────────────────────────────────── */}
      <Group id="notifications" label="Notifications">
      {/* Browser-Notification ping for new pending approvals. The
          in-page prompt on the dashboard handles first-run; this is
          the always-available switch. */}
      <NotificationSettingsControls notif={notif} />

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
      <WebhookSettingsControl />

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

      <AdvancedSettingsControls />
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
