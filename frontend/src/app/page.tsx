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
//   3. Footer - black with massive 'CLEAR' watermark, oversized lime
//      CTA, 3-col policy/social/copyright block.
//
// Typography: Space Grotesk (display + body) + JetBrains Mono
// (technical labels). Scoped via .landing-shell so /app/* keeps
// its existing Geist/Manrope font stack.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  FileText,
  Lock,
  Network,
  ReceiptText,
  Send,
  ShieldCheck,
  Users,
  type LucideIcon,
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
import { CHAINS, SolanaLogo, type ChainMeta } from "@/components/landing/ChainLogos";

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

        <ChainMarquee />

        <Bento fadeIn={fadeIn} />

        <WhyClear fadeIn={fadeIn} />

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
    <section className="relative left-1/2 isolate z-10 min-h-[100svh] w-screen -translate-x-1/2 overflow-hidden bg-[#070807]">
      <Image
        src="/assets/clearsig-hero-bg.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="pointer-events-none absolute inset-0 z-0 scale-[1.04] object-cover object-[64%_50%] opacity-90 sm:scale-[1.02] sm:object-[60%_56%] sm:opacity-95"
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(90deg,rgba(5,5,5,0.96)_0%,rgba(5,5,5,0.80)_34%,rgba(5,5,5,0.42)_62%,rgba(5,5,5,0.74)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] bg-[radial-gradient(circle_at_22%_42%,rgba(204,255,0,0.14),transparent_31%),radial-gradient(circle_at_72%_58%,rgba(204,255,0,0.08),transparent_34%),linear-gradient(180deg,rgba(12,12,12,0.98)_0%,rgba(12,12,12,0.36)_28%,rgba(12,12,12,0.10)_57%,rgba(12,12,12,0.96)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-40 bg-gradient-to-b from-transparent via-[#0c0c0c]/74 to-[#0c0c0c]"
      />
      <div className="relative z-10 mx-auto grid min-h-[100svh] w-full max-w-[1600px] grid-cols-1 items-start gap-10 px-5 pb-20 pt-20 sm:items-center sm:gap-12 sm:px-10 sm:pb-28 sm:pt-32 lg:grid-cols-12 lg:gap-10 lg:pb-36 lg:pt-36">
        {/* Left - copy */}
        <div className="relative mx-auto max-w-3xl text-center lg:col-span-7 lg:mx-0 lg:text-left">

          <motion.h1
            {...fadeIn(0.06)}
            className="landing-section-heading text-[clamp(3rem,8.4vw,7.25rem)] font-medium leading-[0.88] tracking-[-0.04em] text-white drop-shadow-[0_18px_50px_rgba(0,0,0,0.55)] sm:mt-7 sm:leading-[0.85] sm:tracking-[-0.05em]"
          >
            Control money
            <br />
            with people
            <br />
            and <span className="italic-skew">agents</span>.
          </motion.h1>

          <motion.p
            {...fadeIn(0.14)}
            className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-white/68 sm:mt-8 sm:text-lg lg:mx-0"
          >
            ClearSig turns wallets, policies, approvals, recovery, and agent
            trading into one readable signing flow.
          </motion.p>

          <motion.div {...fadeIn(0.2)} className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-10 sm:gap-4 lg:justify-start">
            <Link
              href="/choose"
              className="neon-cta inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[13px] font-bold tracking-tight sm:px-7 sm:py-4 sm:text-[14px]"
            >
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
            </Link>
          </motion.div>
        </div>

        {/* Right - glass mockup. Self-aligned center on lg+ so the
          card's vertical midpoint sits roughly with the headline,
          not floating against the section's grid baseline. */}
        <motion.div
          {...fadeIn(0.18)}
          className="relative lg:col-span-5 lg:self-center lg:translate-y-6"
        >
          <ClearSigningHeroMockup />
        </motion.div>
      </div>
    </section>
  );
}

function ClearSigningHeroMockup() {
  const approvers = [
    { initial: "S", name: "Sarah", state: "signed", color: "#ff725e" },
    { initial: "M", name: "Mark", state: "signed", color: "#6675ff" },
    { initial: "A", name: "Ada", state: "next", color: "#29c6a5" },
  ];
  const checks = ["Limit", "Policy", "Ledger"];
  const route = ["Intent", "Owners", "Ika", "SOL"];

  return (
    <div className="relative mx-auto w-full max-w-[410px] [perspective:1200px] sm:max-w-[560px] lg:mx-0 lg:ml-auto">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.6rem] bg-[#ccff00]/[0.06] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 -bottom-5 h-12 rounded-full bg-black/70 blur-2xl"
      />

      <div
        className="relative overflow-hidden rounded-[1.55rem] bg-[#0b0e0d]/96 p-2.5 shadow-[0_34px_100px_-56px_rgba(0,0,0,0.98)] sm:rounded-[2rem] sm:p-4"
        style={{
          transform: "rotateX(6deg) rotateY(-6deg)",
          transformStyle: "preserve-3d",
        }}
      >
        <div className="rounded-[1.25rem] bg-[#111412] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:rounded-[1.65rem] sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#ccff00] text-black shadow-[0_14px_30px_-20px_rgba(204,255,0,0.8)] sm:h-10 sm:w-10">
                <ReceiptText className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42 sm:text-[11px] sm:tracking-[0.18em]">
                  Treasury Guard
                </p>
                <p className="mt-1 text-sm font-semibold text-white">Proposal #1842</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#ccff00]/10 px-2.5 py-1 text-[11px] font-semibold text-[#ccff00] sm:px-3 sm:py-1.5 sm:text-xs">
              2 of 3
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-[1.15rem] bg-[#080a09] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:rounded-[1.35rem] sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-white/46">Send</p>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-[2.75rem] font-semibold leading-none tracking-[-0.06em] text-white sm:text-[3.25rem]">
                      5
                    </span>
                    <span className="pb-1.5 text-base font-semibold text-white/48">SOL</span>
                  </div>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111614] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                  <SolanaLogo size={23} />
                </span>
              </div>
              <div className="mt-3 rounded-2xl bg-[#111614] px-3.5 py-3 sm:mt-4">
                <p className="text-[11px] font-medium text-white/38">Destination</p>
                <p className="mt-1 text-sm font-semibold text-white/78">Operations vault</p>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
                {checks.map((check) => (
                  <div key={check} className="rounded-2xl bg-[#111614] px-2.5 py-2 sm:px-3 sm:py-2.5">
                    <Check className="h-4 w-4 text-[#ccff00]" aria-hidden="true" strokeWidth={2.8} />
                    <p className="mt-2 text-[11px] font-semibold text-white/58">{check}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="hidden rounded-[1.35rem] bg-[#151a12] p-4 shadow-[inset_0_1px_0_rgba(204,255,0,0.05)] sm:block">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ccff00]">
                    Device
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
                    Ledger ready
                  </p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ccff00] text-black">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" strokeWidth={2.4} />
                </span>
              </div>

              <div className="mt-5 rounded-[1rem] bg-[#070907] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="h-2 w-16 rounded-full bg-white/12" />
                  <span className="rounded-full bg-[#ccff00]/14 px-2 py-1 text-[10px] font-semibold text-[#ccff00]">
                    Ready
                  </span>
                </div>
                <div className="mt-4 rounded-xl bg-[#111614] p-3">
                  <div className="h-3 w-full rounded-full bg-[#ccff00]/70" />
                  <div className="mt-2 h-3 w-3/4 rounded-full bg-white/12" />
                </div>
                <div className="mt-5 flex gap-2">
                  <span className="h-9 flex-1 rounded-full bg-white/[0.06]" />
                  <span className="flex h-9 w-14 items-center justify-center rounded-full bg-[#ccff00] text-black">
                    <Check className="h-4 w-4" aria-hidden="true" strokeWidth={3} />
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-3 rounded-[1.15rem] bg-[#080a09] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:mt-4 sm:rounded-[1.35rem] sm:p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center">
                {approvers.map((approver, index) => (
                  <div
                    key={approver.name}
                    className={index === 0 ? "relative" : "relative -ml-2"}
                  >
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white shadow-[0_0_0_3px_#080a09] sm:h-11 sm:w-11 sm:text-sm"
                      style={{ backgroundColor: approver.color }}
                    >
                      {approver.initial}
                    </span>
                    {approver.state === "signed" ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#ccff00] text-black shadow-[0_0_0_2px_#080a09] sm:h-5 sm:w-5">
                        <Check className="h-3 w-3" aria-hidden="true" strokeWidth={3} />
                      </span>
                    ) : null}
                  </div>
                ))}
                <div className="ml-3">
                  <p className="text-sm font-semibold text-white">Ready to sign</p>
                  <p className="mt-0.5 text-xs text-white/42">Ada is next</p>
                </div>
              </div>

              <div className="hidden items-center gap-1.5 sm:flex">
                {route.map((item, index) => (
                  <div key={item} className="group relative flex items-center gap-1.5">
                    <span
                      className={
                        "h-2 w-2 rounded-full " +
                        (index < 2 ? "bg-[#ccff00]" : "bg-white/18")
                      }
                      aria-hidden="true"
                    />
                    <span className="sr-only">{item}</span>
                    {index < route.length - 1 ? (
                      <span className="h-px w-5 bg-white/12" aria-hidden="true" />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 sm:mt-4">
            <p className="hidden text-xs font-medium text-white/42 sm:block">
              Clear intent, policy checked, ready to sign.
            </p>
            <span className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#ccff00] px-5 text-sm font-bold text-black sm:min-h-11 sm:flex-none">
              Approve
              <Send className="h-4 w-4" aria-hidden="true" strokeWidth={2.6} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}



/* ─────────────────────────────────────────────────────────────────
 *  Bento Grid
 * ───────────────────────────────────────────────────────────────── */

function ChainMarquee() {
  const supportedChains = CHAINS.filter((chain) =>
    ["sol", "eth", "btc", "zec", "hyperliquid"].includes(chain.key),
  );
  const marqueeSet = Array.from({ length: 5 }).flatMap(() => supportedChains);
  const track = [...marqueeSet, ...marqueeSet];

  return (
    <section
      aria-label="Supported networks"
      className="relative left-1/2 z-10 w-screen -translate-x-1/2 overflow-hidden bg-[#0c0c0c] py-5 sm:py-7"
    >
      <div className="mx-auto max-w-[1600px]">
        <div className="landing-chain-marquee relative overflow-hidden bg-[#101311] py-4 shadow-[0_20px_70px_-56px_rgba(0,0,0,0.95)]">
          <div className="landing-chain-marquee-track flex w-max items-center gap-10">
            {track.map((chain, index) => (
              <ChainMarqueeItem
                key={`${chain.key}-${index}`}
                chain={chain}
                duplicate={index >= marqueeSet.length}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChainMarqueeItem({
  chain,
  duplicate,
}: {
  chain: ChainMeta;
  duplicate: boolean;
}) {
  const Logo = chain.Logo;

  return (
    <span
      aria-hidden={duplicate}
      aria-label={duplicate ? undefined : chain.label}
      className="flex h-12 w-12 shrink-0 items-center justify-center"
    >
      <Logo size={28} className="h-7 w-7" />
    </span>
  );
}

type ControlCard = {
  title: string;
  signal: string;
  detail: string;
  Icon: LucideIcon;
  className?: string;
  accent?: boolean;
  chainStrip?: boolean;
};

function Bento({ fadeIn }: { fadeIn: FadeInFn }) {
  const controlCards: ControlCard[] = [
    {
      title: "Intent",
      signal: "Readable",
      detail: "5 SOL to Ops vault.",
      Icon: ReceiptText,
      accent: true,
    },
    {
      title: "Rules",
      signal: "$500 cap",
      detail: "Limit, expiry, device.",
      Icon: ShieldCheck,
    },
    {
      title: "People",
      signal: "2 / 3 signed",
      detail: "Approvers stay visible.",
      Icon: Users,
    },
    {
      title: "Chains",
      signal: "Native",
      detail: "Same policy, every route.",
      Icon: Network,
      chainStrip: true,
    },
    {
      title: "Agents",
      signal: "Bounded",
      detail: "No raw key access.",
      Icon: Bot,
    },
    {
      title: "Receipt",
      signal: "Passed",
      detail: "Proof after signing.",
      Icon: FileText,
    },
  ];
  const [activeControl, setActiveControl] = useState(0);
  const [controlDirection, setControlDirection] = useState(1);

  const goToControl = (index: number) => {
    setControlDirection(index > activeControl ? 1 : -1);
    setActiveControl(index);
  };

  const stepControl = (direction: number) => {
    setControlDirection(direction);
    setActiveControl((current) => (current + direction + controlCards.length) % controlCards.length);
  };

  return (
    <section
      id="bento"
      className="relative z-10 overflow-hidden px-5 pb-16 pt-8 sm:px-10 sm:pb-28 sm:pt-12 lg:pb-32"
    >
      <div className="lg:grid lg:grid-cols-[0.68fr_1.32fr] lg:items-center lg:gap-14">
        <motion.div {...fadeIn(0)} className="mb-8 max-w-3xl text-center sm:mb-10 md:text-left lg:mb-0">
          <h2 className="landing-section-heading mt-3 max-w-2xl text-[clamp(1.75rem,4.5vw,3.5rem)] font-light leading-[1.05] tracking-[-0.03em] text-white sm:tracking-[-0.04em]">
            One control layer
            <br />
            <span className="text-white/40">for every action.</span>
          </h2>
          <span className="mx-auto mt-6 block h-1 w-14 rounded-full bg-[#ccff00] md:mx-0" />
          <p className="mx-auto mt-6 max-w-sm text-sm leading-relaxed text-white/52 sm:text-base md:mx-0">
            Intent enters. Policy checks. Owners approve. ClearSig executes.
          </p>
        </motion.div>

        <div>
          <ControlLayerStack
            cards={controlCards}
            activeIndex={activeControl}
            direction={controlDirection}
            onNext={() => stepControl(1)}
            onPrev={() => stepControl(-1)}
            onSelect={goToControl}
          />

          <div className="hidden gap-4 md:grid md:grid-cols-2 lg:hidden">
            {controlCards.map((card, index) => (
              <ControlLayerCard
                key={card.title}
                {...card}
                fadeIn={fadeIn}
                delay={0.04 + index * 0.04}
              />
            ))}
          </div>

          <ControlLayerDesktopCluster fadeIn={fadeIn} />
        </div>
      </div>
    </section>
  );
}

function ControlLayerDesktopCluster({ fadeIn }: { fadeIn: FadeInFn }) {
  const desktopCards: ControlCard[] = [
    {
      title: "Readable intent",
      signal: "5 SOL",
      detail: "Amount, route, destination.",
      Icon: ReceiptText,
      accent: true,
    },
    {
      title: "Policy guard",
      signal: "$500 cap",
      detail: "Limits and device checks.",
      Icon: ShieldCheck,
    },
    {
      title: "People + agents",
      signal: "2 / 3",
      detail: "Owners approve. Agents stay bounded.",
      Icon: Users,
    },
    {
      title: "Native routes",
      signal: "5 chains",
      detail: "One approval surface.",
      Icon: Network,
      chainStrip: true,
    },
  ];
  const positions = [
    "left-[17%] top-0 w-[16rem] xl:w-[17.5rem]",
    "right-0 top-[13%] w-[16rem] xl:w-[17.5rem]",
    "left-[17%] bottom-[8%] w-[16rem] xl:w-[17.5rem]",
    "right-0 bottom-0 w-[16rem] xl:w-[17.5rem]",
  ];

  return (
    <motion.div
      {...fadeIn(0.08)}
      className="relative hidden min-h-[36rem] lg:block"
    >
      <div
        aria-hidden="true"
        className="absolute left-[28%] top-[7%] h-[30rem] w-[30rem] rounded-full bg-[#171a16]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[36%] top-[18%] h-[18rem] w-[18rem] rounded-full bg-[#1d2515]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[12%] top-[47%] h-14 w-14 rounded-full bg-[#ccff00]"
      />
      <div
        aria-hidden="true"
        className="absolute left-[18%] top-[calc(47%+1.7rem)] h-px w-[17%] bg-[#ccff00]/62"
      />

      {desktopCards.map((card, index) => (
        <DesktopControlCard
          key={card.title}
          card={card}
          className={positions[index]}
        />
      ))}
    </motion.div>
  );
}

function DesktopControlCard({
  card,
  className,
}: {
  card: ControlCard;
  className: string;
}) {
  return (
    <motion.article
      whileHover={{ y: -8, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
      className={
        "absolute min-h-[12.4rem] rounded-[1.4rem] p-5 shadow-[0_32px_76px_-44px_rgba(0,0,0,0.95)] " +
        (card.accent
          ? "bg-[#ccff00] text-black "
          : "bg-[#101311] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] ") +
        className
      }
    >
      <ControlLayerCardBody {...card} compact />
    </motion.article>
  );
}

function ControlLayerStack({
  cards,
  activeIndex,
  direction,
  onNext,
  onPrev,
  onSelect,
}: {
  cards: ControlCard[];
  activeIndex: number;
  direction: number;
  onNext: () => void;
  onPrev: () => void;
  onSelect: (index: number) => void;
}) {
  const activeCard = cards[activeIndex];

  return (
    <div className="md:hidden">
      <div className="relative min-h-[16rem]">
        <div className="absolute inset-x-7 top-8 h-[13rem] rounded-[1.35rem] bg-[#151914] opacity-55" />
        <div className="absolute inset-x-4 top-4 h-[13.75rem] rounded-[1.35rem] bg-[#111512] opacity-80" />
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.article
            key={activeCard.title}
            custom={direction}
            initial={{ opacity: 0, x: direction * 64, rotateY: direction * 10, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, rotateY: 0, scale: 1 }}
            exit={{ opacity: 0, x: direction * -64, rotateY: direction * -10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className={
              "relative z-10 min-h-[14.75rem] rounded-[1.35rem] p-5 shadow-[0_24px_80px_-58px_rgba(0,0,0,0.95)] " +
              (activeCard.accent
                ? "bg-[#ccff00] text-black"
                : "bg-[#101311] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]")
            }
            style={{ transformStyle: "preserve-3d" }}
          >
            <ControlLayerCardBody {...activeCard} />
          </motion.article>
        </AnimatePresence>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onPrev}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#101311] text-white/72 transition-colors hover:text-[#ccff00]"
          aria-label="Previous control card"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
        </button>

        <div className="flex items-center gap-2">
          {cards.map((card, index) => (
            <button
              key={card.title}
              type="button"
              onClick={() => onSelect(index)}
              className={
                "h-2.5 rounded-full transition-all duration-300 " +
                (index === activeIndex ? "w-7 bg-[#ccff00]" : "w-2.5 bg-white/18")
              }
              aria-label={`Show ${card.title}`}
              aria-current={index === activeIndex}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onNext}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00] text-black transition-transform hover:scale-105"
          aria-label="Next control card"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

function ControlLayerCard({
  fadeIn,
  delay,
  ...card
}: ControlCard & {
  fadeIn: FadeInFn;
  delay: number;
}) {
  return (
    <motion.article
      {...fadeIn(delay)}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.985 }}
      className={
        "min-h-[13.5rem] rounded-[1.35rem] p-5 shadow-[0_24px_80px_-58px_rgba(0,0,0,0.95)] transition-transform duration-300 sm:p-6 " +
        (card.accent
          ? "bg-[#ccff00] text-black "
          : "bg-[#101311] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] ") +
        (card.className ?? "")
      }
    >
      <ControlLayerCardBody {...card} />
    </motion.article>
  );
}

function ControlLayerCardBody({
  title,
  signal,
  detail,
  Icon,
  accent,
  chainStrip,
  compact,
}: ControlCard & { compact?: boolean }) {
  const routeChains = CHAINS.filter((chain) =>
    ["sol", "eth", "btc", "zec", "hyperliquid"].includes(chain.key),
  );

  return (
    <div className={"flex h-full flex-col justify-between " + (compact ? "gap-6" : "gap-8")}>
      <div className="flex items-center justify-between gap-4">
        <span
          className={
            (compact
              ? "flex h-10 w-10 items-center justify-center rounded-2xl "
              : "flex h-11 w-11 items-center justify-center rounded-2xl ") +
            (accent ? "bg-black text-[#ccff00]" : "bg-[#ccff00] text-black")
          }
        >
          <Icon className={compact ? "h-[18px] w-[18px]" : "h-5 w-5"} aria-hidden="true" strokeWidth={2.2} />
        </span>
        <span
          className={
            "text-right text-[11px] font-semibold uppercase tracking-[0.16em] " +
            (accent ? "text-black/58" : "text-[#ccff00]")
          }
        >
          {signal}
        </span>
      </div>

      <div>
        <h3
          className={
            (compact ? "text-xl" : "text-2xl") +
            " font-semibold tracking-[-0.04em] " +
            (accent ? "text-black" : "text-white")
          }
        >
          {title}
        </h3>
        <p
          className={
            "mt-2 max-w-sm leading-relaxed " +
            (compact ? "text-xs " : "text-sm ") +
            (accent ? "text-black/64" : "text-white/52")
          }
        >
          {detail}
        </p>
        {chainStrip ? (
          <div className="mt-5 flex items-center gap-3">
            {routeChains.map(({ key, Logo }) => (
              <span
                key={key}
                className={
                  (compact ? "h-8 w-8 " : "h-9 w-9 ") +
                  "flex items-center justify-center rounded-xl bg-[#0b0e0d]"
                }
              >
                <Logo size={compact ? 19 : 22} />
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
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
  const signingRows = [
    ["Action", "Send"],
    ["Amount", "5 SOL"],
    ["To", "Operations vault"],
    ["Policy", "$500 cap passed"],
    ["Owners", "2 of 3 signed"],
  ];
  const contextChecks = [
    { label: "Intent", detail: "Plain action", Icon: ReceiptText },
    { label: "Policy", detail: "Rules checked", Icon: ShieldCheck },
    { label: "Owners", detail: "Approvals clear", Icon: Users },
    { label: "Chain", detail: "Native route", Icon: Network },
  ];

  return (
    <section
      id="why"
      className="relative z-10 px-5 pb-16 pt-4 sm:px-10 sm:pb-28 lg:pb-32"
    >
      <div className="mx-auto max-w-[1440px]">
        <motion.div {...fadeIn(0)} className="mx-auto mb-10 max-w-4xl text-center sm:mb-14 lg:mx-0 lg:text-left">
          <h2 className="landing-section-heading text-[clamp(2.5rem,6vw,5.55rem)] font-light leading-[0.96] tracking-[-0.055em] text-white">
            A shared wallet
            <br />
            you can <span className="italic-skew text-[#ccff00]">read</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/58 sm:text-lg lg:mx-0">
            ClearSig turns every approval into a signing receipt with the action, policy, owners, and route visible before money moves.
          </p>
        </motion.div>

        <motion.div
          {...fadeIn(0.06)}
          className="grid items-center gap-5 lg:grid-cols-[0.82fr_1.18fr] lg:gap-7"
        >
          <div className="relative overflow-hidden rounded-[2rem] bg-[#070807] p-5 shadow-[0_28px_90px_-68px_rgba(0,0,0,1)] sm:p-6 lg:p-7">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-black uppercase tracking-[0.24em] text-white/36">
                Common wallet prompt
              </span>
              <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/34">
                Blind
              </span>
            </div>

            <div className="mt-7 rounded-[1.35rem] bg-[#111412] p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/32">
                Transaction data
              </p>
              <p className="mt-4 break-all font-mono-tech text-[clamp(1.6rem,4vw,3.25rem)] leading-[1.04] tracking-[-0.04em] text-white/36">
                0x7a9f2c01b8e4
              </p>
              <div className="mt-6 grid gap-2">
                {["Program unknown", "Destination hidden", "Policy not shown"].map((item) => (
                  <span
                    key={item}
                    className="flex items-center gap-2 rounded-[0.9rem] bg-black/24 px-3 py-2 text-sm font-semibold text-white/38"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white/28" aria-hidden="true" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-[1.25rem] bg-[#111412] px-4 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/32">
                Result
              </p>
              <p className="mt-2 text-2xl font-black tracking-[-0.045em] text-white/48">
                Approve and hope.
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] bg-[#050705] p-4 shadow-[0_28px_100px_-70px_rgba(0,0,0,1)] sm:p-6 lg:p-7">
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)",
                backgroundSize: "34px 34px",
                maskImage: "radial-gradient(circle at 52% 48%, black 0%, black 56%, transparent 78%)",
              }}
            />

            <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#ccff00]">
                  ClearSig receipt
                </p>
                <h3 className="mt-2 text-[clamp(1.9rem,3vw,3rem)] font-black leading-none tracking-[-0.055em] text-white">
                  Read before signing.
                </h3>
              </div>
              <span className="flex w-fit items-center gap-2 rounded-full bg-[#ccff00] px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-black">
                <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
                Ready
              </span>
            </div>

            <div className="relative z-10 mt-6 grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
              <div className="rounded-[1.6rem] bg-[#ccff00] p-5 text-black shadow-[0_24px_80px_-58px_rgba(204,255,0,0.95)] sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-black/54">
                      Signing receipt
                    </p>
                    <p className="mt-4 text-[clamp(3.2rem,6vw,5rem)] font-black leading-none tracking-[-0.075em]">
                      5 SOL
                    </p>
                    <p className="mt-2 text-base font-black text-black/64">
                      to Operations vault
                    </p>
                  </div>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black text-[#ccff00]">
                    <ReceiptText className="h-6 w-6" aria-hidden="true" strokeWidth={2.2} />
                  </span>
                </div>

                <div className="mt-6 grid gap-2">
                  {signingRows.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[4.6rem_minmax(0,1fr)] gap-3 rounded-[0.9rem] bg-black/[0.08] px-3 py-3"
                    >
                      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-black/45">
                        {label}
                      </span>
                      <span className="text-sm font-black text-black/76">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                {contextChecks.map(({ label, detail, Icon }) => (
                  <div key={label} className="flex items-center gap-3 rounded-[1.15rem] bg-[#111412] p-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#ccff00] text-black">
                      <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-black tracking-[-0.02em] text-white">
                        {label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white/42">{detail}</p>
                    </div>
                    <Check className="h-4 w-4 text-[#ccff00]" aria-hidden="true" strokeWidth={2.8} />
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#111412] px-3 py-1.5 text-xs font-semibold text-white/58">
                Human-readable
              </span>
              <span className="rounded-full bg-[#111412] px-3 py-1.5 text-xs font-semibold text-white/58">
                Policy-aware
              </span>
              <span className="rounded-full bg-[#111412] px-3 py-1.5 text-xs font-semibold text-white/58">
                Owner-approved
              </span>
              <span className="rounded-full bg-[#111412] px-3 py-1.5 text-xs font-semibold text-white/58">
                Native execution
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}


/* ─────────────────────────────────────────────────────────────────
 *  Agent control map - product schematic
 * ───────────────────────────────────────────────────────────────── */

function AgentControlSection({ fadeIn }: { fadeIn: FadeInFn }) {
  const points = [
    {
      label: "Owners set the lane",
      value: "Market, size, stop loss, and approvals.",
    },
    {
      label: "Agent submits a request",
      value: "Readable trade intent, not wallet access.",
    },
    {
      label: "ClearSig enforces",
      value: "Execute what fits. Block what does not.",
    },
  ];

  return (
    <section
      id="agents"
      className="relative z-10 overflow-hidden px-5 pb-16 pt-4 sm:px-10 sm:pb-28 lg:pb-32"
    >
      <div className="relative mx-auto grid max-w-[1500px] grid-cols-1 items-center gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
        <motion.div {...fadeIn(0)} className="max-w-xl">
          <h2 className="landing-section-heading mt-6 text-[clamp(2.35rem,6vw,4.95rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white">
            Agents trade
            inside approved <span className="italic-skew">lanes</span>
          </h2>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-white/60 sm:text-base">
            Owners give an agent a narrow lane. The agent can ask for trades, but ClearSig checks every request before signing.
          </p>

          <div className="mt-8 grid gap-5">
            {points.map((point, index) => (
              <div key={point.label} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ccff00] text-sm font-black text-black shadow-[0_16px_42px_-28px_rgba(204,255,0,0.9)]">
                  {index + 1}
                </span>
                <span>
                  <span className="block text-base font-black tracking-[-0.025em] text-white">
                    {point.label}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-white/48">
                    {point.value}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div {...fadeIn(0.12)} className="relative min-w-0">
          <AgentLaneIllustration />
        </motion.div>
      </div>
    </section>
  );
}

function AgentLaneIllustration() {
  const reduceMotion = useReducedMotion();
  const laneRules = [
    { label: "Market", value: "SOL only" },
    { label: "Max", value: "$500" },
    { label: "Risk", value: "Stop loss" },
    { label: "Owners", value: "2 of 3" },
  ];

  return (
    <div
      className="relative overflow-hidden rounded-[2rem] bg-[#050705] p-4 shadow-[0_34px_100px_-76px_rgba(0,0,0,1)] sm:rounded-[2.6rem] sm:p-7 lg:p-8"
      aria-label="Owners approve an agent lane. The agent requests trades. ClearSig executes only what fits the lane."
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          maskImage: "radial-gradient(circle at 52% 52%, black 0%, black 56%, transparent 78%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ccff00]/[0.045] blur-3xl"
      />

      <div className="relative z-10 grid gap-4 sm:hidden">
        <div className="rounded-[1.65rem] bg-[#ccff00] p-5 text-black shadow-[0_22px_70px_-48px_rgba(204,255,0,0.95)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-black/48">
                Approved lane
              </p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.04em]">Treasury agent</h3>
            </div>
            <ShieldCheck className="h-8 w-8" aria-hidden="true" strokeWidth={2.2} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {laneRules.map((rule) => (
              <span key={rule.label} className="rounded-[0.9rem] bg-black/10 px-3 py-2">
                <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-black/44">
                  {rule.label}
                </span>
                <span className="mt-0.5 block text-xs font-black text-black/76">
                  {rule.value}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-[1.45rem] bg-[#111412] p-4 shadow-[0_18px_60px_-44px_rgba(0,0,0,0.98)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ccff00] text-black">
              <Bot className="h-5 w-5" aria-hidden="true" strokeWidth={2.1} />
            </span>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/36">
                Agent request
              </p>
              <p className="mt-0.5 text-base font-black text-white">Buy 3 SOL</p>
            </div>
          </div>
          <p className="mt-4 text-xs font-semibold leading-relaxed text-white/48">
            Signed only if it matches the lane.
          </p>
        </div>

        <div className="rounded-[1.45rem] bg-[#ccff00] p-4 text-black shadow-[0_18px_50px_-36px_rgba(204,255,0,0.9)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-[#ccff00]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" strokeWidth={2.25} />
          </span>
          <p className="mt-4 text-[9px] font-black uppercase tracking-[0.2em] text-black/48">
            ClearSig gate
          </p>
          <p className="mt-1 text-xl font-black leading-none tracking-[-0.04em]">
            Check lane
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[1.35rem] bg-[#ccff00] p-4 text-black shadow-[0_18px_50px_-36px_rgba(204,255,0,0.9)]">
            <Send className="h-5 w-5" aria-hidden="true" strokeWidth={2.1} />
            <p className="mt-3 text-[9px] font-black uppercase tracking-[0.18em] text-black/52">
              In lane
            </p>
            <p className="mt-1 text-base font-black">Execute</p>
          </div>
          <div className="rounded-[1.35rem] bg-[#111412] p-4 text-white/82 shadow-[0_18px_50px_-38px_rgba(0,0,0,0.95)]">
            <Lock className="h-5 w-5 text-white/58" aria-hidden="true" strokeWidth={2.1} />
            <p className="mt-3 text-[9px] font-black uppercase tracking-[0.18em] text-white/34">
              Out of lane
            </p>
            <p className="mt-1 text-base font-black">Block</p>
          </div>
        </div>
      </div>

      <div className="relative z-10 hidden min-h-[520px] grid-cols-[minmax(0,1.05fr)_minmax(10rem,0.72fr)_minmax(0,0.98fr)] items-center gap-5 sm:grid xl:gap-7">
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 900 520"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M238 282 H410"
            fill="none"
            stroke="#ccff00"
            strokeOpacity="0.28"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M500 282 C590 282 628 174 748 174"
            fill="none"
            stroke="#ccff00"
            strokeOpacity="0.3"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M500 282 C590 282 628 372 748 372"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M188 200 V256"
            fill="none"
            stroke="#ccff00"
            strokeOpacity="0.26"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {!reduceMotion ? (
            <>
              <motion.circle
                r="5"
                fill="#ccff00"
                animate={{ cx: [238, 410, 500, 748], cy: [282, 282, 282, 174], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut" }}
              />
              <motion.circle
                r="4"
                fill="rgba(255,255,255,0.58)"
                animate={{ cx: [238, 410, 500, 748], cy: [282, 282, 282, 372], opacity: [0, 0.8, 0.55, 0] }}
                transition={{ duration: 5.8, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
              />
            </>
          ) : null}
        </svg>

        <div className="relative z-10 grid gap-5 self-center">
          <div className="rounded-[2rem] bg-[#ccff00] p-6 text-black shadow-[0_28px_90px_-62px_rgba(204,255,0,0.95)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.26em] text-black/48">
                  Approved lane
                </p>
                <h3 className="mt-2 text-[clamp(1.85rem,2.5vw,2.65rem)] font-black leading-none tracking-[-0.06em]">
                  Treasury agent
                </h3>
              </div>
              <Users className="h-8 w-8 shrink-0" aria-hidden="true" strokeWidth={2.2} />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2.5">
              {laneRules.map((rule) => (
                <span key={rule.label} className="rounded-[1rem] bg-black/10 px-3.5 py-3">
                  <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-black/42">
                    {rule.label}
                  </span>
                  <span className="mt-1 block text-sm font-black text-black/76">
                    {rule.value}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[1.6rem] bg-[#111412] p-5 shadow-[0_24px_80px_-52px_rgba(0,0,0,1)]">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00] text-black">
                <Bot className="h-5 w-5" aria-hidden="true" strokeWidth={2.1} />
              </span>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/36">
                  Agent request
                </p>
                <p className="mt-0.5 text-xl font-black tracking-[-0.04em] text-white">
                  Buy 3 SOL
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-white/45">
              The agent asks. It never holds the wallet.
            </p>
          </div>
        </div>

        <div className="relative z-10 self-center rounded-[2rem] bg-[#ccff00] p-5 text-black shadow-[0_28px_92px_-58px_rgba(204,255,0,0.95)]">
          <div className="flex items-center justify-between gap-4 lg:block">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-[#ccff00]">
              <ShieldCheck className="h-7 w-7" aria-hidden="true" strokeWidth={2.25} />
            </span>
            <div className="min-w-0 lg:mt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-black/48">
                ClearSig gate
              </p>
              <h3 className="mt-1 text-[clamp(1.8rem,2.35vw,2.55rem)] font-black leading-none tracking-[-0.055em]">
                Check lane
              </h3>
            </div>
          </div>
        </div>

        <div className="relative z-10 grid gap-5 self-center">
          <div className="rounded-[1.6rem] bg-[#ccff00] p-5 text-black shadow-[0_24px_76px_-54px_rgba(204,255,0,0.95)]">
            <Send className="h-6 w-6" aria-hidden="true" strokeWidth={2.1} />
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-black/50">
              In lane
            </p>
            <h3 className="mt-1 text-[clamp(1.75rem,2.35vw,2.55rem)] font-black tracking-[-0.055em]">
              Execute
            </h3>
            <p className="mt-3 text-xs font-semibold leading-relaxed text-black/56">
              Amount, market, risk, and approvals pass.
            </p>
          </div>

          <div className="rounded-[1.6rem] bg-[#111412] p-5 text-white shadow-[0_24px_76px_-52px_rgba(0,0,0,1)]">
            <Lock className="h-6 w-6 text-white/58" aria-hidden="true" strokeWidth={2.1} />
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/34">
              Out of lane
            </p>
            <h3 className="mt-1 text-[clamp(1.75rem,2.35vw,2.55rem)] font-black tracking-[-0.055em]">
              Block
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-white/42">
              Anything outside policy never reaches signing.
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-4 flex items-center gap-2 rounded-full bg-[#111412]/90 px-4 py-2 text-[12px] font-semibold text-white/50 shadow-[0_18px_46px_-34px_rgba(0,0,0,0.95)] backdrop-blur-md sm:mx-auto sm:mt-0 sm:w-fit">
        <Check className="h-4 w-4 text-[#ccff00]" aria-hidden="true" strokeWidth={2.6} />
        A lane is permission. It is not wallet custody.
      </div>
    </div>
  );
}

function Footer({ fadeIn }: { fadeIn: FadeInFn }) {
  return (
    <footer className="relative left-1/2 right-1/2 z-10 -ml-[50vw] -mr-[50vw] w-screen overflow-hidden bg-black pb-10 pt-20 sm:pt-32">
      {/* Massive watermark */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 select-none text-center font-medium leading-[0.85] tracking-[-0.06em] text-white/[0.04]"
        style={{ fontSize: "clamp(6rem, 18vw, 16rem)" }}
      >
        CLEAR
      </div>

      <div className="relative mx-auto w-full max-w-[1600px] px-5 sm:px-10">
        {/* CTA stack */}
        <div className="relative mx-auto max-w-3xl text-center">
          <motion.div {...fadeIn(0)} className="flex items-center justify-center gap-2">
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/60">
              Ready when you are
            </span>
          </motion.div>

          <motion.h2
            {...fadeIn(0.06)}
            className="landing-section-heading mt-5 text-[clamp(2rem,6vw,5rem)] font-light leading-[0.95] tracking-[-0.04em] text-white sm:mt-6"
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

