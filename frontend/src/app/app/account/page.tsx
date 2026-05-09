"use client";

// Account - your identity, security, and the sign-out exit.
//
// Split out from Settings so the user-centric concerns (who am I,
// who can sign in as me, how do I lock my session, how do I leave)
// are clearly separated from app-level preferences.
//
// Layout (product-grade pass):
//   • Centered max-w-3xl column on desktop so the page reads as a
//     focused stack instead of full-bleed.
//   • Refined page header (mono eyebrow + display title + subtitle).
//   • Identity hero card (header strip pattern, status pill, copy).
//   • Quick links section: Contacts shortcut (room to add more later).
//   • Security group: App lock + Sign-in security.
//   • Sign out at the foot - destructive leaf, separate from groups.

import { motion, useReducedMotion } from "framer-motion";
import { IdentityCard } from "@/components/settings/IdentityCard";
import { AppLockRow } from "@/components/settings/AppLockRow";
import { SignInSecurityRow } from "@/components/settings/SignInSecurityRow";
import { SignOutCard } from "@/components/settings/SignOutCard";

export default function AccountPage() {
  const reduce = useReducedMotion();
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-3xl flex-col gap-8"
    >
      {/* Page header - mono eyebrow + display title (md+) + subtitle.
          Mobile shows the title in the top bar (HeaderBar's centered
          title) so the eyebrow stands alone here without doubling up. */}
      <header className="px-gutter">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Your account
        </p>
        <h1 className="mt-2 hidden font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong md:block">
          Account
        </h1>
        <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-text-soft sm:text-[14px]">
          Your identity, the locks that gate it, and the door out.
        </p>
      </header>

      {/* Identity hero - lead card with avatar + connection status +
          copyable address. */}
      <IdentityCard />

      {/* Security group - App lock + Sign-in security. */}
      <Section
        label="Security"
        description="What it takes to act as you on this device."
      >
        <AppLockRow />
        <SignInSecurityRow />
      </Section>

      {/* Sign out - destructive leaf in its own group so the "leave"
          intent is unambiguous. */}
      <Section
        label="Sign out"
        description="Disconnect this device and return to the landing page."
      >
        <SignOutCard />
      </Section>
    </motion.div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────
//
// Consistent group-header treatment so every band on the page reads
// with the same eyebrow / description / content rhythm. Centralised
// here rather than copy-pasted at each site so any future tweak
// (typography, spacing) hits all groups at once.

function Section({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5 px-gutter">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          {label}
        </h2>
        {description && (
          <p className="text-[12px] leading-relaxed text-text-soft/80">
            {description}
          </p>
        )}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
