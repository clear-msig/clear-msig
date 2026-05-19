"use client";

// /privacy - how Clear keeps shared-wallet rules private. Dressed in
// the marketing chrome (LandingNav + LandingAtmospherics) so /,
// /privacy, /security and /welcome all read as one product surface.
//
// Tone: forward-looking, honest about pre-alpha. When Encrypt is live,
// the only thing that changes is dropping the "Preview" callout near
// the bottom.

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import {
  LandingAtmospherics,
  LandingNav,
} from "@/components/landing/LandingChrome";
import {
  LandingBackToTop,
  LandingScrollProgress,
} from "@/components/landing/LandingScrollUI";
import { encryptStatus, localCiphertextCount } from "@/lib/encrypt/client";

export default function PrivacyPage() {
  const reduce = useReducedMotion();
  const status = encryptStatus();

  // Tangible proof the Encrypt surface fires on every policy change -
  // count of locally-stored ciphertexts. Refreshes once on mount;
  // localStorage doesn't have a change event we'd want to subscribe
  // to in this context.
  const [ctCount, setCtCount] = useState<number | null>(null);
  useEffect(() => {
    setCtCount(localCiphertextCount());
  }, []);

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
              Privacy · how Clear keeps your rules private
            </span>
          </div>

          <h1 className="mt-6 text-[clamp(2.25rem,7vw,5rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white sm:mt-8">
            Your rules are
            <br />
            <span className="italic-skew text-[#ccff00]">yours alone</span>.
          </h1>

          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/60 sm:text-base">
            Clear&rsquo;s shared wallets are private by design. Who can spend,
            how many friends need to approve, the limits you set, none of it
            is readable by anyone else.
          </p>
        </motion.section>

        {/* ─── Visibility split ───────────────────────────── */}
        <motion.section {...fadeIn(0.05)} className="mt-12 sm:mt-16">
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/50">
            Visibility · what is and isn&rsquo;t public
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            <Tile
              Icon={EyeOff}
              tone="hidden"
              title="What stays hidden"
              body="Member list, approval thresholds, allowances per friend, recipient lists you set up. The wallet works the same; the rules aren't visible to outsiders."
            />
            <Tile
              Icon={Eye}
              tone="public"
              title="What's still public"
              body="Whether the wallet exists. Whether it has approved transactions. The bytes a friend signs. Anything that was always public on a blockchain stays that way."
            />
          </div>
        </motion.section>

        {/* ─── Verified-not-trusted ───────────────────────── */}
        <motion.section
          {...fadeIn(0.1)}
          className="mt-12 overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.02] backdrop-blur-md sm:mt-16"
        >
          <div className="grid grid-cols-1 gap-0 md:grid-cols-[auto_1fr]">
            <div className="flex items-center justify-center border-b border-white/[0.08] bg-[#ccff00]/[0.04] p-8 md:border-b-0 md:border-r md:p-10">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ccff00]/15 text-[#ccff00] ring-1 ring-[#ccff00]/30 sm:h-20 sm:w-20">
                <ShieldCheck
                  className="h-8 w-8 sm:h-10 sm:w-10"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="p-6 sm:p-8">
              <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
                Verified, not just trusted
              </p>
              <h2 className="mt-3 font-display text-2xl leading-tight tracking-[-0.01em] text-white sm:text-3xl">
                Checked without being seen
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/60 sm:text-base">
                Clear uses encryption that lets the on-chain program check
                approvals against your rules{" "}
                <em className="text-white/85">without ever decrypting them</em>
                . The network enforces what you set up, but only your
                wallet&rsquo;s members can see what those rules are.
              </p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.03] px-3 py-1 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
                Powered by <span className="text-white">Encrypt</span> · FHE
                primitives
              </p>
            </div>
          </div>
        </motion.section>

        {/* ─── Status ─────────────────────────────────────── */}
        <motion.section
          {...fadeIn(0.15)}
          className={
            "mt-6 overflow-hidden rounded-[1.25rem] border p-5 backdrop-blur-md sm:p-6 " +
            (status.live
              ? "border-[#ccff00]/30 bg-[#ccff00]/[0.04]"
              : "border-white/[0.12] bg-white/[0.02]")
          }
        >
          <div className="flex items-center gap-2">
            <span
              className={
                "relative flex h-1.5 w-1.5 " + (status.live ? "" : "opacity-60")
              }
            >
              <span
                className={
                  "absolute inline-flex h-full w-full animate-ping rounded-full " +
                  (status.live ? "bg-[#ccff00]/70" : "bg-white/40")
                }
              />
              <span
                className={
                  "relative inline-flex h-1.5 w-1.5 rounded-full " +
                  (status.live ? "bg-[#ccff00]" : "bg-white/60")
                }
              />
            </span>
            <span
              className={
                "font-mono-tech text-[10px] uppercase tracking-[0.28em] " +
                (status.live ? "text-[#ccff00]" : "text-white/60")
              }
            >
              {status.live ? "Encryption active" : "Preview note"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/75">
            {status.description}
          </p>
          {ctCount !== null && ctCount > 0 && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.03] px-3 py-1 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
              <span className="font-numerals text-white">{ctCount}</span>{" "}
              polic{ctCount === 1 ? "y" : "ies"} routed through Encrypt on this
              device
            </p>
          )}
        </motion.section>

        {/* ─── CTA ────────────────────────────────────────── */}
        <motion.section
          {...fadeIn(0.2)}
          className="mt-16 flex flex-col items-start gap-4 sm:mt-20 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-md text-sm text-white/60">
            Policy values route through the Encrypt surface today. On-chain FHE
            enforcement switches on when the Encrypt network support lands.
          </p>
          <Link
            href="/welcome"
            className="neon-cta inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13px] font-bold tracking-tight"
          >
            Try Clear
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </motion.section>
      </main>
    </div>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────

function Tile({
  Icon,
  title,
  body,
  tone,
}: {
  Icon: typeof Lock;
  title: string;
  body: string;
  tone: "hidden" | "public";
}) {
  const accent =
    tone === "hidden"
      ? "bg-[#ccff00]/10 text-[#ccff00] ring-[#ccff00]/20"
      : "bg-white/[0.06] text-white/80 ring-white/[0.12]";
  return (
    <article className="group relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md transition-colors duration-300 hover:border-white/[0.16] sm:p-6">
      <div
        className={
          "flex h-10 w-10 items-center justify-center rounded-xl ring-1 " +
          accent
        }
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-display text-lg leading-tight text-white">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{body}</p>
    </article>
  );
}
