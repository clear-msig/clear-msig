"use client";

// /security - plain-language security posture, dressed in the
// marketing chrome (LandingNav + LandingAtmospherics) so /, /privacy,
// /security and /welcome all read as one product surface.
//
// The full attack-surface walkthrough lives in SECURITY.md at the
// project root. This page is the human-readable subset: what we
// protect, what users should do, what's still rough.

import Link from "next/link";
import nextDynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ExternalLink,
  Globe,
  ShieldCheck,
} from "lucide-react";
import {
  LandingAtmospherics,
  LandingNav,
} from "@/components/landing/LandingChrome";
import {
  LandingBackToTop,
  LandingScrollProgress,
} from "@/components/landing/LandingScrollUI";

// PasskeyCard + LedgerCard are the only pieces on this page that need
// Dynamic Labs + the LedgerProvider context. Hosting them in a
// separately-imported "use client" module + loading via next/dynamic
// keeps the Dynamic SDK out of /security's initial chunk. Marketing
// copy + watchlist + pre-alpha disclosure render immediately; the
// interactive cards hydrate moments later when the lazy chunk lands.
const InteractiveSecurityCards = nextDynamic(
  () => import("@/components/security/InteractiveSecurityCards"),
  { ssr: false, loading: () => null },
);

export default function SecurityPage() {
  const reduce = useReducedMotion();
  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.5,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <LandingScrollProgress />
      <LandingBackToTop />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <LandingAtmospherics />
      </div>

      <LandingNav />

      <main className="relative mx-auto w-full max-w-[1100px] px-5 pb-24 pt-6 sm:px-10 sm:pb-32">
        {/* ─── Hero ────────────────────────────────────────── */}
        <motion.section
          {...fadeIn(0)}
          className="border-b border-white/[0.08] pb-12 sm:pb-16"
        >
          <div className="flex items-center gap-2">
            <span className="lime-dot h-1.5 w-1.5 rounded-full bg-[#ccff00] shadow-[0_0_4px_rgba(204,255,0,0.4)]" />
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/60">
              Security · how Clear protects you
            </span>
          </div>

          <h1 className="mt-6 text-[clamp(2.25rem,7vw,5rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white sm:mt-8">
            Keeping your wallet
            <br />
            <span className="italic-skew">safe</span>.
          </h1>

          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/60 sm:text-base">
            What we protect, what to watch for, and what to turn on. Pre-alpha,
            so this page is a contract, not a polished marketing claim. The
            full model is in{" "}
            <a
              href="https://github.com/clear-msig/clear-msig/blob/main/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-[#ccff00]"
            >
              SECURITY.md
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            .
          </p>
        </motion.section>

        {/* ─── Watchlist ──────────────────────────────────── */}
        <motion.section {...fadeIn(0.05)} className="mt-12 sm:mt-16">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/50">
            Watchlist · the basics
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            <InfoCard
              Icon={Globe}
              title="Always sign in here"
              body="Bookmark the address bar. Look-alike sites can mint a real wallet under someone else's control while you think you're signing into Clear. If anything in the URL looks off, close the tab."
            />
            <InfoCard
              Icon={ShieldCheck}
              title="Read the destination before signing"
              body="Every send shows the recipient's short address right above the wallet popup. If that address looks wrong, cancel. Contacts can be edited on this device. The address is the truth, the name is the convenience."
            />
          </div>
        </motion.section>

        {/* ─── Account hardening ──────────────────────────── */}
        <motion.section {...fadeIn(0.1)} className="mt-12 sm:mt-16">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/50">
            Harden your account
          </p>
          <InteractiveSecurityCards />
        </motion.section>

        {/* ─── Pre-alpha disclosure ───────────────────────── */}
        <motion.aside
          {...fadeIn(0.15)}
          className="mt-12 flex items-start gap-3 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md sm:p-6"
        >
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
            Pre-alpha
          </span>
          <p className="text-sm leading-relaxed text-white/60">
            Some encryption protections in the UI ride on the Encrypt network
            going live. Until then, they show a pre-alpha chip. Read the full
            attack model and current gaps in{" "}
            <a
              href="https://github.com/clear-msig/clear-msig/blob/main/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-white underline decoration-white/30 underline-offset-4 hover:decoration-[#ccff00]"
            >
              SECURITY.md
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            .
          </p>
        </motion.aside>

        {/* ─── CTA ────────────────────────────────────────── */}
        <motion.section
          {...fadeIn(0.2)}
          className="mt-16 flex flex-col items-start gap-4 sm:mt-20 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-md text-sm text-white/60">
            Ready to set up a shared wallet? Defaults are safe you can layer
            on a passkey or Ledger from inside the app any time.
          </p>
          <Link
            href="/welcome"
            className="neon-cta inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-bold tracking-tight"
          >
            Launch app
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </motion.section>
      </main>
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────

function InfoCard({
  Icon,
  title,
  body,
}: {
  Icon: typeof Globe;
  title: string;
  body: string;
}) {
  return (
    <article className="group relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md transition-colors duration-300 hover:border-white/[0.16] sm:p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ccff00]/10 text-[#ccff00] ring-1 ring-[#ccff00]/20">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-display text-lg leading-tight text-white">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
    </article>
  );
}

