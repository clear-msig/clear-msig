"use client";

// Landing page - Obsidian & Lime rebuild (locked 2026-05-08).
//
// Floating shell architecture: black viewport → rounded #0c0c0c
// container with grid + noise + glow-sphere atmospherics. Replaces
// the previous calm-retail layout with a high-contrast tech-industrial
// design language while preserving the original copy hierarchy:
//
//   1. Hero - same headline ("Send money with people you trust"),
//      same subhead, same single CTA.
//   2. Bento grid - features re-cast from the old Trust / How-it-works
//      content into a 4-col bento with lime accent + glass cards.
//   3. Methodology - light-contrast section hosting the original
//      three steps (Create / Ask / Approve) as numbered items.
//   4. Footer - black with massive 'CLEAR' watermark, oversized lime
//      CTA, 3-col policy/social/copyright block.
//
// Typography: Space Grotesk (display + body) + JetBrains Mono
// (technical labels). Scoped via .landing-shell so /app/* keeps
// its existing Geist/Manrope font stack.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  Gauge,
  Lock,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import nextDynamic from "next/dynamic";
import { LandingAtmospherics, LandingNav } from "@/components/landing/LandingChrome";
import {
  LandingBackToTop,
  LandingScrollProgress,
} from "@/components/landing/LandingScrollUI";
import { SecureSection } from "@/components/landing/SecureSection";
import { BrandMark } from "@/components/retail/BrandMark";
import { ClearCMark } from "@/components/landing/ClearCMark";
import { CHAINS } from "@/components/landing/ChainLogos";
import { HowItWorksDiagram } from "@/components/landing/HowItWorksDiagram";

// Auto-redirect for already-authenticated users is now lazy-loaded
// in a separate async chunk so the marketing landing can render
// without pulling the Dynamic SDK into its initial bundle. Returning
// signed-in users still get bounced to /app/wallet. Just a fraction
// of a second after first paint instead of synchronously at mount.
// First-time visitors never pay the cost.
const AutoRedirectIsland = nextDynamic(
  () => import("@/components/landing/AutoRedirectIsland"),
  { ssr: false, loading: () => null },
);

export default function HomePage() {
  const reduce = useReducedMotion();

  // Scroll-reveal factory. Switched from animate-on-mount to
  // `whileInView` with `once: true` so each section blooms as the
  // user scrolls past it - the page reveals itself rather than
  // dumping every section at once. Hero still fires immediately
  // because it's already in viewport at page load (amount: 0.18
  // satisfies). `margin: -10%` pulls the trigger up a bit so the
  // reveal starts just before each section's top edge enters.
  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.18, margin: "0px 0px -10% 0px" },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    // Bleed-to-edge full-bleed shell. The previous floating-rounded
    // container with ring + shadow has been removed; the obsidian
    // canvas blends from viewport edge to edge while the inner
    // sections stay capped at max-w-[1600px]. Sticky nav lives
    // OUTSIDE the overflow-hidden atmospherics wrapper so the sticky
    // positioning works (sticky doesn't survive an overflow:hidden
    // ancestor).
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      {/* Scroll progress strip (lime accent, top of viewport) and a
          floating back-to-top button. Both are client-only, respect
          reduced-motion, and stay above the atmospherics layer. */}
      <LandingScrollProgress />
      <LandingBackToTop />

      {/* Lazy auto-redirect for returning authenticated users.
          Renders null; only exists to host useWalletGate() behind a
          lazy boundary so the Dynamic SDK stays out of the landing's
          static bundle. */}
      <AutoRedirectIsland />

      {/* atmospherics live in their own absolute overflow-hidden
          wrapper that sits behind sections (z-0) - so the sticky
          nav can layer above them without clipping. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>

      <LandingNav />

      <main className="relative mx-auto w-full max-w-[1600px]">
        <Hero fadeIn={fadeIn} />

        <Bento fadeIn={fadeIn} />

        <WhyClear fadeIn={fadeIn} />

        <Methodology fadeIn={fadeIn} />

        <AgentControlSection fadeIn={fadeIn} />

        <SecureSection />

        <Footer fadeIn={fadeIn} />
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Hero - split 12-col
 * ───────────────────────────────────────────────────────────────── */

interface FadeInFn {
  (delay?: number): Record<string, unknown>;
}

function Hero({ fadeIn }: { fadeIn: FadeInFn }) {
  return (
    <section className="relative z-10 grid grid-cols-1 gap-10 px-5 pb-16 pt-6 sm:gap-12 sm:px-10 sm:pb-28 sm:pt-16 lg:grid-cols-12 lg:gap-8 lg:pb-32 lg:pt-20">
      {/* Left - copy */}
      <div className="lg:col-span-7">
        <motion.div {...fadeIn(0)} className="flex items-center">
          <span className="font-mono-tech text-[9px] uppercase tracking-[0.3em] text-white/60 sm:text-[10px] sm:tracking-[0.32em]">
            Clear signing for shared wallets
          </span>
        </motion.div>

        <motion.h1
          {...fadeIn(0.06)}
          className="mt-5 text-[clamp(2.75rem,9vw,7.5rem)] font-medium leading-[0.88] tracking-[-0.04em] text-white sm:mt-7 sm:leading-[0.85] sm:tracking-[-0.05em]"
        >
          Sign the
          <br />
          sentence.
          <br />
          Not the <span className="italic-skew">hex</span>.
        </motion.h1>

        <motion.p
          {...fadeIn(0.14)}
          className="mt-6 max-w-md text-[15px] leading-relaxed text-white/60 sm:mt-8 sm:text-lg"
        >
          ClearSig turns approvals, recovery, cross-chain sends, and agent
          trading into receipts people can read before they sign.
        </motion.p>

        <motion.div {...fadeIn(0.2)} className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10 sm:gap-4">
          <Link
            href="/choose"
            className="neon-cta inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[13px] font-bold tracking-tight sm:flex-none sm:px-7 sm:py-4 sm:text-[14px]"
          >
            Start a wallet
            <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
          </Link>
          <Link
            href="#methodology"
            className="group inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3.5 text-[12px] font-medium text-white/80 transition-colors duration-200 hover:border-white/40 hover:text-white sm:flex-none sm:px-6 sm:py-4 sm:text-[13px]"
          >
            See the flow
          </Link>
        </motion.div>

        {/* Signature strip: the literal artefact ClearSig owns is
            not a KPI row, it is the readable sentence a signer can
            understand before approving. */}
        <motion.div
          {...fadeIn(0.26)}
          className="mt-12 max-w-xl sm:mt-14"
        >
          <HeroIntentRail />
        </motion.div>
      </div>

      {/* Right - glass mockup. Self-aligned center on lg+ so the
          card's vertical midpoint sits roughly with the headline,
          not floating against the section's grid baseline. */}
      <motion.div
        {...fadeIn(0.18)}
        className="relative lg:col-span-5 lg:self-center"
      >
        <HeroMockup />
      </motion.div>
    </section>
  );
}

function HeroIntentRail() {
  const rows = [
    ["intent", "Approve Steady BTC to trade BTC-PERP"],
    ["limit", "$500 max · 2x leverage · stop required"],
    ["expires", "Jan 1, 2026 · owner can pause anytime"],
  ];

  return (
    <div className="intent-rail relative overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.025] p-3.5 shadow-[0_22px_70px_-42px_rgba(204,255,0,0.45)] sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-mono-tech text-[9px] uppercase tracking-[0.28em] text-white/40">
          signer receipt
        </span>
        <span className="rounded-full border border-[#ccff00]/25 bg-[#ccff00]/[0.08] px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[0.18em] text-[#ccff00]">
          clear text
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="intent-rail-row grid grid-cols-[5.8rem_minmax(0,1fr)] items-start gap-3 rounded-xl px-3 py-2.5"
          >
            <span className="font-mono-tech text-[9px] uppercase tracking-[0.2em] text-white/35">
              {label}
            </span>
            <span className="text-[12px] leading-snug text-white/78 sm:text-[13px]">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroMockup() {
  // Three approver avatars - first two have approved (lime tick),
  // third is pending. Names are intentionally human (no addresses,
  // no "maya.eth"-style identifiers) so the mockup tells the story
  // a friend-and-family wallet is meant to tell.
  const approvers = [
    { initial: "S", name: "Sarah", tone: "from-[#ff8a4c] to-[#ff5a8a]", approved: true },
    { initial: "M", name: "Mark", tone: "from-[#7c4dff] to-[#4dc3ff]", approved: true },
    { initial: "A", name: "Ada", tone: "from-[#10b981] to-[#34d399]", approved: false },
  ];

  return (
    <div className="hero-mockup-wrap relative mx-auto w-full max-w-[520px] lg:mx-0 lg:ml-auto">
      {/* Ambient lime + purple backdrop glows - sit behind the card
          (-z-10) so the card looks like it's blooming out of light. */}
      <div
        aria-hidden="true"
        className="absolute -inset-12 -z-10 rounded-[3rem] opacity-60"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, rgba(204, 255, 0, 0.20) 0%, rgba(204, 255, 0, 0) 55%)",
          filter: "blur(72px)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -inset-12 -z-10 rounded-[3rem] opacity-40"
        style={{
          background:
            "radial-gradient(circle at 75% 80%, rgba(124, 77, 255, 0.20) 0%, rgba(124, 77, 255, 0) 60%)",
          filter: "blur(80px)",
        }}
      />

      {/* Flat glass card - content dictates height. The previous
          3D tilt + fixed aspect ratio was squashing/clipping content;
          a clean flat card with strong shadow reads as a real product
          screenshot without the distortion. */}
      <div className="product-card relative flex flex-col overflow-hidden rounded-[1.35rem] p-4 sm:p-5">
          {/* Inner specular highlight - mimics light hitting a tilted
              glass panel. Cheap CSS gradient, no extra DOM cost. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[1.35rem]"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(204, 255, 0,0.05) 100%)",
            }}
          />

          {/* Header - app pill (avatar + name) on the left, soft
              status chip on the right. Replaces the macOS traffic
              lights + jargon "proposal · #042" of the old mockup. */}
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-black shadow-[0_0_12px_rgba(204,255,0,0.16)]">
                <ClearCMark size={20} variant="on-light" />
              </span>
              <div className="leading-tight">
                <div className="text-[13px] font-semibold text-white">Proposal #1842</div>
                <div className="text-[11px] text-white/40">Treasury control</div>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/70">
                live
              </span>
            </span>
          </div>

          {/* Sender row - "Sarah is asking" reads as a sentence,
              not a JSON field. The whole card is built like a
              chat receipt, which is the mental model we want. */}
          <div className="relative mt-6 text-[12px] text-white/55">
            <span className="font-medium text-white/85">Treasury Guard</span> requested approval
          </div>

          {/* Amount block. Two-line: big SOL number, dim USD below.
              Right side carries an avatar of the recipient so the
              destination has a face, not a base58 string. */}
          <div className="relative mt-2 flex items-end justify-between gap-4">
            <div>
              <div className="text-[44px] font-light leading-none tracking-tight text-white sm:text-[52px]">
                $500 <span className="text-white/40">limit</span>
              </div>
              <div className="mt-1.5 text-[12px] text-white/40">$125 used today</div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="text-right leading-tight">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">agent</div>
                <div className="text-[13px] font-semibold text-white">Steady BTC</div>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ccff00]/10 text-[13px] font-semibold text-[#ccff00] ring-1 ring-[#ccff00]/25">
                AI
              </span>
            </div>
          </div>

          {/* Memo - a single human line of context. The whole point
              of clear-signing is that approvers see *meaning*, not
              hex; the memo strip drives that home. */}
          <div className="product-field relative mt-5 rounded-xl px-3.5 py-3">
            <div className="flex items-start gap-2 text-[12px] text-white/70">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ccff00]" strokeWidth={2.4} />
              <span>
                <span className="text-white/45">Policy - </span>
                BTC-PERP, max 2x leverage, stop loss required.
              </span>
            </div>
          </div>

          {/* Approval roster. Each avatar is gradient-filled so the
              row feels alive vs three identical lime circles. The
              first two carry a small lime tick badge; the third
              shows a dashed pending ring. */}
          <div className="relative mt-5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium text-white/55">
                Humans approving
              </div>
              <div className="text-[11px] font-semibold text-[#ccff00]">
                2 of 3
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              {approvers.map((a) => (
                <div key={a.initial} className="flex flex-col items-center gap-1.5">
                  <div className="relative">
                    <span
                      className={
                        "flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-semibold text-white bg-gradient-to-br " +
                        a.tone +
                        (a.approved ? "" : " opacity-45 grayscale")
                      }
                    >
                      {a.initial}
                    </span>
                    {a.approved ? (
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#ccff00] text-black ring-2 ring-[#0c0c0c]">
                        <Check className="h-3 w-3" strokeWidth={3.5} />
                      </span>
                    ) : (
                      <span
                        className="absolute -inset-1 rounded-full border border-dashed border-[#ccff00]/55"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-white/55">{a.name}</span>
                </div>
              ))}
            </div>
            {/* Progress bar - 2/3 filled in lime, third in dim
                white. Reads as a scoreboard at a glance. */}
            <div className="mt-5 h-[5px] w-full overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-[#ccff00] shadow-[0_0_6px_rgba(204, 255, 0,0.25)]"
                style={{ width: "66.67%" }}
              />
            </div>
          </div>

          {/* Action footer */}
          <div className="product-field relative mt-5 flex items-center justify-between rounded-xl px-4 py-3">
            <div className="leading-tight">
              <div className="text-[11px] text-white/45">One more approval</div>
              <div className="text-[13px] font-semibold text-white">Ada signs the policy</div>
            </div>
            <span className="rounded-full bg-[#ccff00] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_10px_rgba(204, 255, 0,0.20)]">
              Approve
            </span>
          </div>
      </div>

      {/* Floating verification chip - sits on the top-right edge
          of the mockup, partially overlapping. */}
      <div className="float-slow absolute right-3 -top-4 z-20 hidden items-center gap-2.5 rounded-2xl border border-white/[0.10] bg-[#0c0c0c]/90 px-3.5 py-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md sm:flex">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ccff00]/10 ring-1 ring-[#ccff00]/30">
          <ShieldCheck className="h-3.5 w-3.5 text-[#ccff00]" strokeWidth={2.2} />
        </span>
        <div className="leading-tight">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/40">Hardware</div>
          <div className="text-[11px] font-semibold text-white">Ledger verified</div>
        </div>
      </div>

      {/* Floating fee chip - sits on the bottom-left edge of the
          mockup, partially overlapping. */}
      <div className="float-slower absolute -left-3 bottom-12 z-20 hidden items-center rounded-full border border-white/[0.10] bg-[#0c0c0c]/90 px-3.5 py-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md sm:flex">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/85">
          Fee &lt; $0.01
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Bento Grid
 * ───────────────────────────────────────────────────────────────── */

function Bento({ fadeIn }: { fadeIn: FadeInFn }) {
  return (
    <section
      id="bento"
      className="relative z-10 px-5 pb-16 sm:px-10 sm:pb-28 lg:pb-32"
    >
      <motion.div {...fadeIn(0)} className="mb-8 flex items-end justify-between sm:mb-10">
        <div>
          <h2 className="mt-3 max-w-2xl text-[clamp(1.75rem,4.5vw,3.5rem)] font-light leading-[1.05] tracking-[-0.03em] text-white sm:tracking-[-0.04em]">
            One control layer
            <br />
            <span className="text-white/40">for every action.</span>
          </h2>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
        {/* Large 2x2 - Verification visualization */}
        <motion.div
          {...fadeIn(0.04)}
          className="product-card group relative overflow-hidden rounded-[1.5rem] p-6 transition-colors duration-300 hover:border-[#ccff00]/40 sm:p-8 lg:col-span-2 lg:row-span-2"
        >
          <BentoLargeBars />
        </motion.div>

        {/* Tall 1x2 - Chain swatches */}
        <motion.div
          {...fadeIn(0.1)}
          className="product-card group relative overflow-hidden rounded-[1.5rem] p-6 transition-colors duration-300 hover:border-[#ccff00]/40 sm:p-7 md:col-span-2 lg:col-span-1 lg:row-span-2"
        >
          <BentoChainSwatches />
        </motion.div>

        {/* Lime accent - Policy controls */}
        <motion.div
          {...fadeIn(0.16)}
          className="product-card relative overflow-hidden rounded-[1.5rem] p-6 text-white sm:p-7"
        >
          <div className="relative">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#ccff00]" strokeWidth={2.5} />
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
                controls
              </span>
            </div>
            <div className="mt-8 text-2xl font-light leading-[1.1] tracking-tight">
              Rules first.
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-white/60">
              Limits, allowances, budgets, and approvals stay visible before anything moves.
            </p>
            <div className="mt-6 space-y-2">
              {[
                ["Daily spend", "$500"],
                ["Leverage", "2x max"],
                ["Signer rule", "2 of 3"],
              ].map(([label, value]) => (
                <div key={label} className="product-field flex items-center justify-between rounded-xl px-3 py-2">
                  <span className="text-[11px] text-white/45">{label}</span>
                  <span className="text-[12px] font-semibold text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Small glass - Ledger */}
        <motion.div
          {...fadeIn(0.22)}
          className="product-card group relative overflow-hidden rounded-[1.5rem] p-6 transition-colors duration-300 hover:border-[#ccff00]/40 sm:p-7"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#ccff00]" strokeWidth={2} />
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
              sign
            </span>
          </div>
          <div className="mt-12 text-2xl font-light leading-[1.1] tracking-tight text-white">
            Hardware ready.
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            Ledger support keeps high-value approvals tied to a real signing device.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function BentoLargeBars() {
  // Animated approval cycle. The card cycles through 4 states on a
  // ~6.4s loop while in view, so a passing reader actually sees the
  // approval flow happen, not a still life:
  //
  //   step 0 - Sarah signing
  //   step 1 - Sarah signed,  Mark signing
  //   step 2 - Sarah + Mark signed,  Ada signing
  //   step 3 - all signed,  "Sent" pill appears (held longer)
  //   → loops back to 0
  //
  // The progress bar width is bound to signedCount so it physically
  // fills as the count climbs. The check-badge appearance per row is
  // gated by AnimatePresence so each badge pops in with a spring at
  // the moment its row flips from signing → signed.
  //
  // useInView gates the cycle so the animation only runs while the
  // card is actually on screen - no offscreen tick churn. Reduced-
  // motion users get pinned to step 3 (the "fully signed" final
  // state) so the card still tells the story.

  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(containerRef, { amount: 0.35, once: false });
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduce) {
      setStep(3);
      return;
    }
    if (!inView) return;
    // Hold the "Sent" frame slightly longer than the others so the
    // resolution lands - feels rewarding instead of a flash.
    const STEP_HOLD_MS = [1500, 1500, 1500, 2400];
    const t = setTimeout(
      () => setStep((s) => (s + 1) % 4),
      STEP_HOLD_MS[step],
    );
    return () => clearTimeout(t);
  }, [step, inView, reduce]);

  const approvers = [
    { initial: "S", name: "Sarah", grad: "from-[#ff8a4c] to-[#ff5a8a]" },
    { initial: "M", name: "Mark", grad: "from-[#7c4dff] to-[#4dc3ff]" },
    { initial: "A", name: "Ada", grad: "from-[#10b981] to-[#34d399]" },
  ];

  function rowState(i: number): "pending" | "signing" | "signed" {
    if (step === 3) return "signed";
    if (i < step) return "signed";
    if (i === step) return "signing";
    return "pending";
  }

  const signedCount = step === 3 ? 3 : step;
  const progressPct = (signedCount / 3) * 100;

  return (
    <div ref={containerRef}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
            approvals
          </span>
        </div>
        <span className="inline-flex items-center font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
          live
        </span>
      </div>

      {/* Plain-English signed sentence - the literal thing the
          approvers see in their wallet. */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }}
        className="receipt-scan product-field relative mt-6 overflow-hidden rounded-xl p-5 sm:p-6"
      >
        <div className="relative flex items-center">
          <span className="font-mono-tech text-[9px] uppercase tracking-[0.22em] text-white/45">
            What you&apos;re signing
          </span>
        </div>
        <p className="relative mt-3 text-[clamp(1.05rem,2.4vw,1.4rem)] font-light leading-snug tracking-[-0.01em] text-white">
          &ldquo;Agent may move{" "}
          <span className="amount-glow font-medium text-[#ccff00]">$500</span>{" "}
          on <span className="font-medium">Hyperliquid testnet</span>,
          <br className="hidden sm:block" /> expires{" "}
          <span className="font-medium">Jan 1, 2026</span>.&rdquo;
        </p>
      </motion.div>

      {/* Approver roster. Each row's right slot swaps between
          pending / signing / signed based on `step`. AnimatePresence
          handles the transitions so badges pop and dots fade. */}
      <ul className="mt-5 space-y-2.5">
        {approvers.map((a, i) => {
          const state = rowState(i);
          const dim = state === "pending";
          return (
            <motion.li
              key={a.name}
              animate={{
                borderColor:
                  state === "signing"
                    ? "rgba(204, 255, 0,0.22)"
                    : "rgba(255,255,255,0.04)",
                backgroundColor:
                  state === "signing"
                    ? "rgba(204, 255, 0,0.04)"
                    : "rgba(255,255,255,0.015)",
              }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
              className="product-field flex items-center gap-3 rounded-xl px-3 py-2.5"
            >
              <motion.span
                animate={{ opacity: dim ? 0.45 : 1 }}
                transition={{ duration: 0.4 }}
                className={
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[12px] font-semibold text-white " +
                  a.grad
                }
              >
                {a.initial}
              </motion.span>
              <motion.span
                animate={{ color: dim ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.92)" }}
                transition={{ duration: 0.4 }}
                className="text-[13px] font-medium"
              >
                {a.name}
              </motion.span>
              <div className="ml-auto flex items-center">
                <AnimatePresence mode="wait" initial={false}>
                  {state === "pending" && (
                    <motion.span
                      key="pending"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="font-mono-tech text-[10px] uppercase tracking-[0.18em] text-white/30"
                    >
                      waiting
                    </motion.span>
                  )}
                  {state === "signing" && (
                    <motion.span
                      key="signing"
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -4 }}
                      transition={{ duration: 0.3 }}
                      className="inline-flex items-center gap-2 text-[11px] font-mono-tech uppercase tracking-[0.18em] text-[#ccff00]"
                    >
                      signing
                      <span className="inline-flex items-center gap-1">
                        <span className="signing-dot h-1 w-1 rounded-full bg-[#ccff00]" />
                        <span className="signing-dot h-1 w-1 rounded-full bg-[#ccff00]" />
                        <span className="signing-dot h-1 w-1 rounded-full bg-[#ccff00]" />
                      </span>
                    </motion.span>
                  )}
                  {state === "signed" && (
                    <motion.span
                      key="signed"
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="inline-flex items-center gap-2 text-[11px] text-white/55"
                    >
                      <span className="font-mono-tech tracking-[0.06em]">
                        signed
                      </span>
                      <motion.span
                        initial={{ scale: 0, rotate: -12 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{
                          type: "spring" as const,
                          damping: 11,
                          stiffness: 320,
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ccff00] text-black"
                      >
                        <Check className="h-3 w-3" strokeWidth={3.2} />
                      </motion.span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ul>

      {/* Progress bar - width animated to signedCount/3. */}
      <div className="mt-5 h-[5px] w-full overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          className="h-full rounded-full bg-[#ccff00]"
          initial={{ width: "0%" }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }}
        />
      </div>

      {/* "Sent" success pill - only at step 3. Lands with a spring,
          slides out cleanly when the cycle resets. */}
      <div className="mt-4 h-9">
        <AnimatePresence>
          {step === 3 && (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 8, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{
                type: "spring" as const,
                damping: 16,
                stiffness: 260,
              }}
              className="inline-flex items-center gap-2 rounded-full border border-[#ccff00]/35 bg-[#ccff00]/[0.08] px-3 py-1.5"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ccff00] text-black">
                <Check className="h-3 w-3" strokeWidth={3.2} />
              </span>
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-[#ccff00]">
                sent · all approved
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-5 max-w-md">
        <h3 className="text-3xl font-light leading-[1.05] tracking-[-0.02em] text-white sm:text-4xl">
          Approvals,
          <br />
          <span className="text-white/40">in plain English.</span>
        </h3>
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          Every request reads as a sentence. Members see the policy, amount,
          destination, and expiry before they sign.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-6 border-t border-white/10 pt-4">
        <div>
          {/* Live count. The `key` swap makes framer-motion remount
              on each change so the number pops with a tiny spring. */}
          <motion.div
            key={signedCount}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring" as const,
              damping: 14,
              stiffness: 320,
            }}
            className="text-2xl font-light text-white"
          >
            {signedCount}/3
          </motion.div>
          <div className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
            approvals to send
          </div>
        </div>
        <div>
          <div className="text-2xl font-light text-white">∞</div>
          <div className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
            members
          </div>
        </div>
      </div>
    </div>
  );
}

function BentoChainSwatches() {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60">
          chains
        </span>
      </div>

      {/* Real brand logos in a tinted square so each chain reads
          instantly. Each row carries a subtle accent ring + tinted
          background using the chain's signature colour, replacing
          the previous gradient swatches. */}
      <div className="mt-6 space-y-2">
        {CHAINS.map(({ key, label, accent, Logo }, i) => (
          <div
            key={key}
            className="flex items-center justify-between border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
            style={{ opacity: 1 - i * 0.04 }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl ring-1"
                style={{
                  background: `${accent}1a`,
                  borderColor: `${accent}40`,
                  // Use box-shadow for the ring to apply colour vs a
                  // ring-* utility (which expects opacity tokens).
                  boxShadow: `inset 0 0 0 1px ${accent}33`,
                }}
              >
                <Logo size={20} />
              </span>
              <span className="font-mono-tech text-[11px] uppercase tracking-[0.18em] text-white/85">
                {key}
              </span>
            </div>
            <span className="text-[11px] text-white/40">{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h3 className="text-2xl font-light leading-[1.1] tracking-tight text-white">
          One policy.
          <br />
          <span className="text-white/40">Native chains.</span>
        </h3>
        <p className="mt-3 text-[13px] leading-relaxed text-white/60">
          Solana, EVM, Bitcoin, Zcash, and Hyperliquid flows stay under the
          same approval surface.
        </p>
      </div>

      <div className="mt-5 inline-flex items-center rounded-full border border-white/15 px-3 py-1.5">
        <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/70">
          Native, not wrapped
        </span>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Why Clear - comparison vs regular multisig
 *
 *  Side-by-side rows on md+ (left = regular multisig, right = Clear);
 *  stacks pair-by-pair on mobile so each row's "before vs after"
 *  relationship stays visible without scrolling past a header. Each
 *  card carries its own "Regular multisig" / "Clear" mono chip so a
 *  user landing mid-section never loses orientation.
 * ───────────────────────────────────────────────────────────────── */

function WhyClear({ fadeIn }: { fadeIn: FadeInFn }) {
  const rows: { bad: { title: string; body: string }; good: { title: string; body: string } }[] = [
    {
      bad: {
        title: "Sign random gibberish",
        body: "Your wallet shows a wall of letters and numbers. You tap approve and hope it's right.",
      },
      good: {
        title: "Sign a sentence",
        body: "The signer sees the amount, action, policy, destination, and expiry in plain language.",
      },
    },
    {
      bad: {
        title: "Agents get raw access",
        body: "Most automation asks for broad keys, exchange access, or manual trust.",
      },
      good: {
        title: "Agents get bounded authority",
        body: "ClearSig checks markets, size, leverage, sessions, stops, and owner approval before execution.",
      },
    },
    {
      bad: {
        title: "One chain at a time",
        body: "Want to send Ethereum? Set up a whole new wallet over there. Then again for Bitcoin.",
      },
      good: {
        title: "One wallet, every chain",
        body: "Solana, EVM, Bitcoin, Zcash, and testnet trading flows share one policy surface.",
      },
    },
    {
      bad: {
        title: "Revenue before value",
        body: "Seat fees charge the wallet even when nothing moves.",
      },
      good: {
        title: "Gas-fee aligned",
        body: "ClearSig earns when approved transactions execute, with fees shown before signing.",
      },
    },
  ];

  return (
    <section
      id="why"
      className="relative z-10 px-5 pb-16 sm:px-10 sm:pb-28 lg:pb-32"
    >
      {/* Centered section header. Bigger, more confident. */}
      <motion.div {...fadeIn(0)} className="mx-auto mb-12 max-w-3xl text-center sm:mb-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/65">
            why clearsig
          </span>
        </div>
        <h2 className="mt-6 text-[clamp(2rem,5vw,4rem)] font-light leading-[1.02] tracking-[-0.04em] text-white">
          Not your usual <span className="italic-skew">shared wallet</span>.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-white/55 sm:text-base">
          ClearSig is built for shared wallets, bounded agents, and policy
          controlled execution. The user signs intent, not mystery payloads.
        </p>
      </motion.div>

      {/* Single comparison panel. One big rounded glass surface
          split into two columns - dim "old way" on the left, lime
          "with Clearsig" on the right. Each comparison is one row;
          rows share dividers, so the eye reads the four rows as a
          single transformation rather than eight separate cards. */}
      <motion.div
        {...fadeIn(0.06)}
        className="relative mx-auto max-w-5xl overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-white/[0.015] sm:rounded-[2.5rem]"
      >
        {/* Soft lime glow anchoring the right column so the
            "Clearsig" side reads as the warm, branded half without
            an explicit dividing border. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 top-0 h-[80%] w-[60%] opacity-40"
          style={{
            background:
              "radial-gradient(circle at 70% 30%, rgba(204, 255, 0, 0.18) 0%, rgba(204, 255, 0, 0) 60%)",
            filter: "blur(80px)",
          }}
        />

        {/* Column headers */}
        <div className="relative grid grid-cols-1 border-b border-white/[0.06] md:grid-cols-2">
          <div className="px-6 py-5 sm:px-8 sm:py-6">
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/40">
              The old way
            </span>
          </div>
          <div className="border-t border-white/[0.06] bg-[#ccff00]/[0.04] px-6 py-5 sm:px-8 sm:py-6 md:border-l md:border-t-0">
            <span className="inline-flex items-center">
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
                With Clearsig
              </span>
            </span>
          </div>
        </div>

        {/* Comparison rows */}
        <div className="relative">
          {rows.map((r, i) => (
            <div
              key={r.good.title}
              className={
                "relative grid grid-cols-1 md:grid-cols-2 " +
                (i < rows.length - 1 ? "border-b border-white/[0.06]" : "")
              }
            >
              {/* Bad cell */}
              <div className="relative px-6 py-7 sm:px-8 sm:py-9">
                <div className="flex items-start gap-3">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/35">
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                  <div className="flex-1">
                    <h3 className="text-[17px] font-medium leading-snug text-white/55 line-through decoration-white/15 decoration-1 sm:text-lg">
                      {r.bad.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-white/40 sm:text-sm">
                      {r.bad.body}
                    </p>
                  </div>
                </div>
              </div>

              {/* Arrow indicator - only on md+ where the two cells
                  sit side by side. Sits centered on the column
                  divider, vertically centered in this row, so the
                  transformation reads visually. z-10 lifts it
                  above the cell backgrounds. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-[#0c0c0c] text-[#ccff00] shadow-[0_0_10px_rgba(204, 255, 0,0.14)] md:flex"
              >
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </div>

              {/* Good cell */}
              <div className="relative border-t border-white/[0.06] bg-[#ccff00]/[0.025] px-6 py-7 sm:px-8 sm:py-9 md:border-l md:border-t-0">
                <div className="flex items-start gap-3">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ccff00] text-black shadow-[0_0_6px_rgba(204, 255, 0,0.20)]">
                    <Check className="h-3 w-3" strokeWidth={3.2} />
                  </span>
                  <div className="flex-1">
                    <h3 className="text-[17px] font-medium leading-snug tracking-[-0.01em] text-white sm:text-lg">
                      {r.good.title}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-white/65 sm:text-sm">
                      {r.good.body}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Methodology - light contrast section
 * ───────────────────────────────────────────────────────────────── */

function Methodology({ fadeIn }: { fadeIn: FadeInFn }) {
  const steps = [
    {
      n: "01",
      Icon: Users,
      title: "Create the control layer",
      body: "Add members, chains, policies, budgets, and recovery rules.",
    },
    {
      n: "02",
      Icon: Send,
      title: "Propose an action",
      body: "A member or agent submits a readable intent with limits and expiry.",
    },
    {
      n: "03",
      Icon: UserPlus,
      title: "Approve and execute",
      body: "Owners sign the sentence, ClearSig checks policy, then execution can proceed.",
    },
  ];

  return (
    // Methodology now renders on the obsidian canvas (no light-grey
    // contrast section) so the new animated diagram - which uses
    // lime pulses on a dark surface - reads cleanly. Numbered steps
    // re-skinned for white-on-dark to match.
    <section
      id="methodology"
      className="relative z-10 px-5 pb-16 sm:px-10 sm:pb-28 lg:pb-32"
    >
      <div className="relative grid grid-cols-1 items-center gap-12 sm:gap-16 lg:grid-cols-12 lg:gap-12">
        {/* Left - numbered list */}
        <div className="lg:col-span-6">
          <motion.div {...fadeIn(0)} className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/65">
              how it works
            </span>
          </motion.div>

          <motion.h2
            {...fadeIn(0.06)}
            className="mt-6 text-[clamp(2rem,5vw,4rem)] font-light leading-[1.02] tracking-[-0.04em] text-white"
          >
            Three checks.
            <br />
            <span className="text-white/40">No blind signing.</span>
          </motion.h2>

          <ol className="mt-10 space-y-3 sm:mt-12">
            {steps.map((step, i) => (
              <motion.li
                key={step.n}
                {...fadeIn(0.1 + i * 0.06)}
                className="group flex items-start gap-5 border-t border-white/[0.08] py-5 first:border-t-0 first:pt-0 sm:gap-6 sm:py-6"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 font-mono-tech text-[11px] font-medium tracking-[0.1em] text-white/70 transition-colors duration-200 group-hover:border-[#ccff00] group-hover:bg-[#ccff00] group-hover:text-black sm:h-12 sm:w-12 sm:text-[12px]">
                  {step.n}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-medium tracking-tight text-white sm:text-2xl">
                      {step.title}
                    </h3>
                    <step.Icon
                      className="h-4 w-4 text-white/40"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-2 max-w-md text-[14px] leading-relaxed text-white/55 sm:text-[15px]">
                    {step.body}
                  </p>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>

        {/* Right - animated flow diagram replaces the rotating orb.
            The diagram tells the same story as the numbered list
            (friends → wallet → chains) but as a continuous flow
            with traveling lime pulses, so the section reads even
            without scanning the text. */}
        <motion.div {...fadeIn(0.16)} className="relative lg:col-span-6">
          <HowItWorksDiagram />
        </motion.div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Footer - black with watermark + lime CTA + 3-col
 * ───────────────────────────────────────────────────────────────── */

function AgentControlSection({ fadeIn }: { fadeIn: FadeInFn }) {
  const checks = [
    { label: "Market", value: "BTC-PERP" },
    { label: "Size", value: "$500" },
    { label: "Leverage", value: "2x" },
    { label: "Stop loss", value: "Required" },
  ];

  return (
    <section
      id="agents"
      className="relative z-10 grid grid-cols-1 items-center gap-10 px-5 pb-16 pt-4 sm:gap-14 sm:px-10 sm:pb-28 lg:grid-cols-12 lg:gap-12 lg:pb-32"
    >
      <motion.div {...fadeIn(0)} className="lg:col-span-5">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#ccff00]/30 bg-[#ccff00]/[0.06] px-3 py-1.5 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-[#ccff00]">
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          Agent trading vault
        </span>
        <h2 className="mt-6 text-[clamp(2.25rem,6vw,4.75rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white">
          Let agents act
          <br />
          inside your <span className="italic-skew">rules</span>.
        </h2>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/60 sm:text-base">
          Agents can propose trades, earn small allowances, and execute only
          inside limits approved by the wallet owners.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {["Signal inbox", "Owner approval", "Kill switch", "Scorecards"].map((item) => (
            <div
              key={item}
              className="product-field rounded-xl px-4 py-3"
            >
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.22em] text-white/45">
                {item}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div {...fadeIn(0.12)} className="relative lg:col-span-7">
        <div
          aria-hidden="true"
          className="absolute -inset-10 -z-10 rounded-[3rem] opacity-60"
          style={{
            background:
              "radial-gradient(circle at 35% 20%, rgba(204, 255, 0, 0.18) 0%, rgba(204, 255, 0, 0) 58%), radial-gradient(circle at 80% 78%, rgba(16,185,129,0.16) 0%, rgba(16,185,129,0) 62%)",
            filter: "blur(72px)",
          }}
        />
        <div className="product-card relative overflow-hidden rounded-[1.35rem] p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <span className="font-mono-tech text-[9px] uppercase tracking-[0.22em] text-white/35">
              vault.clear.local
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ccff00]/10 text-[#ccff00] ring-1 ring-[#ccff00]/30">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">Steady BTC</p>
                <p className="text-[11px] text-white/40">Practice trader</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ccff00]/30 bg-[#ccff00]/[0.08] px-3 py-1 font-mono-tech text-[10px] uppercase tracking-[0.18em] text-[#ccff00]">
              active allowance
            </span>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="product-field rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono-tech text-[10px] uppercase tracking-[0.22em] text-white/40">
                    New signal
                  </p>
                  <h3 className="mt-2 text-2xl font-light tracking-tight text-white">
                    Long BTC-PERP
                  </h3>
                </div>
                <span className="rounded-full bg-[#ccff00] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-black">
                  Review
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {checks.map((check) => (
                  <div
                    key={check.label}
                    className="product-field rounded-xl p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-white/40">{check.label}</span>
                      <Check className="h-3.5 w-3.5 text-[#ccff00]" aria-hidden="true" />
                    </div>
                    <p className="mt-1 text-sm font-semibold text-white">{check.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-[#ccff00]/20 bg-[#ccff00]/[0.06] p-3">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-[#ccff00]" aria-hidden="true" />
                  <p className="text-xs font-medium text-white">Policy gate passed</p>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                  Within market, notional, leverage, session, and stop rules.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <AgentMetric
                icon={CircleDollarSign}
                label="Allowance"
                value="$500"
                detail="4 hours left"
              />
              <AgentMetric
                icon={Activity}
                label="Risk"
                value="1 open"
                detail="Max 2 positions"
              />
              <AgentMetric
                icon={TrendingUp}
                label="Score"
                value="72"
                detail="Trusted tier pending"
              />
              <div className="product-field rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <ReceiptText className="h-4 w-4 text-[#ccff00]" aria-hidden="true" />
                  <span className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-white/45">
                    audit
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-white/70">
                  Owner approval recorded. Execution waits for signed venue handoff.
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function AgentMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="product-field rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-white/40">
            {label}
          </p>
          <p className="mt-1 text-2xl font-light text-white">{value}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] text-[#ccff00]">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-[12px] text-white/45">{detail}</p>
    </div>
  );
}

function Footer({ fadeIn }: { fadeIn: FadeInFn }) {
  return (
    <footer className="relative z-10 overflow-hidden bg-black px-5 pb-10 pt-20 sm:px-10 sm:pt-32">
      {/* Massive watermark */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 select-none text-center font-medium leading-[0.85] tracking-[-0.06em] text-white/[0.04]"
        style={{ fontSize: "clamp(6rem, 18vw, 16rem)" }}
      >
        CLEAR
      </div>

      {/* CTA stack */}
      <div className="relative mx-auto max-w-3xl text-center">
        <motion.div {...fadeIn(0)} className="flex items-center justify-center gap-2">
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/60">
            Ready when you are
          </span>
        </motion.div>

        <motion.h2
          {...fadeIn(0.06)}
          className="mt-5 text-[clamp(2rem,6vw,5rem)] font-light leading-[0.95] tracking-[-0.04em] text-white sm:mt-6"
        >
          Open your <span className="italic-skew">control</span>
          <br />
          wallet.
        </motion.h2>

        <motion.div {...fadeIn(0.14)} className="mt-8 flex justify-center sm:mt-10">
          <Link
            href="/choose"
            className="neon-cta inline-flex items-center gap-3 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight sm:px-9 sm:py-5 sm:text-[15px]"
          >
            Get started
            <ArrowRight className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </motion.div>
      </div>

      {/* 3-col bottom */}
      <div className="relative mt-24 grid grid-cols-1 gap-8 border-t border-white/10 pt-8 sm:mt-40 sm:gap-10 sm:pt-10 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg">
              <ClearCMark size={28} variant="on-dark" />
            </span>
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
              clearsig
            </span>
          </div>
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/50">
            Early preview. Test network only - please don&apos;t use real money yet.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 md:justify-center">
          {[
            { href: "/privacy", label: "Privacy" },
            { href: "/security", label: "Security" },
            { href: "/choose", label: "Choose product" },
          ].map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="font-mono-tech text-[11px] uppercase tracking-[0.2em] text-white/60 transition-colors duration-200 hover:text-[#ccff00]"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-4 md:justify-end">
          <Link
            href="https://x.com/Clearsig_XYZ"
            target="_blank"
            rel="noreferrer"
            aria-label="Clearsig on X"
            title="@Clearsig_XYZ"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors duration-200 hover:border-[#ccff00] hover:text-[#ccff00]"
          >
            <XGlyph />
          </Link>
          <a
            href="mailto:info@clearsig.xyz"
            aria-label="Email Clearsig"
            title="info@clearsig.xyz"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors duration-200 hover:border-[#ccff00] hover:text-[#ccff00]"
          >
            <MailGlyph />
          </a>
          <Link
            href="https://github.com/clear-msig/clear-msig"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/60 transition-colors duration-200 hover:border-[#ccff00] hover:text-[#ccff00]"
          >
            <GitHubGlyph />
          </Link>
          <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/40">
            © 2026 clearsig
          </span>
        </div>
      </div>
    </footer>
  );
}

function GitHubGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
