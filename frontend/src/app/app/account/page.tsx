"use client";

// Account - your identity, security, and the sign-out exit.
//
// Split out from Settings so the user-centric concerns (who am I,
// who can sign in as me, how do I lock my session, how do I leave)
// are clearly separated from app-level preferences (theme,
// notifications, RPC overrides, install prompt).
//
// What lives here:
//   • Identity hero - connected wallet card with copyable address
//   • Contacts shortcut - your local address book
//   • Security - App lock (PIN) + Sign-in security (passkey via Dynamic)
//   • Sign out - destructive leaf action

import Link from "next/link";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Contact } from "lucide-react";
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
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-1">
          <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
            Account
          </h1>
          <p className="text-xs text-text-soft sm:text-sm">
            Your identity, security, and sign-out.
          </p>
        </div>
      </header>

      {/* Identity - lead card with avatar + copyable address. */}
      <IdentityCard />

      {/* Address book shortcut - saved names for sending money. */}
      <Link
        href="/app/contacts"
        className={clsx(
          "group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest",
          "transition-[transform,border-color,box-shadow] duration-base ease-out-soft",
          "hover:-translate-y-0.5 hover:shadow-card-raised",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Contact className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
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

      {/* Security group - App lock + Sign-in security. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Security
          </h2>
          <p className="text-xs text-text-soft/80">
            What it takes to act as you on this device.
          </p>
        </div>
        <AppLockRow />
        <SignInSecurityRow />
      </section>

      {/* Sign out - destructive leaf, in its own group so the
          "leave" intent is unambiguous. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Sign out
          </h2>
          <p className="text-xs text-text-soft/80">
            Disconnect this device and return to the landing page.
          </p>
        </div>
        <SignOutCard />
      </section>
    </motion.div>
  );
}
