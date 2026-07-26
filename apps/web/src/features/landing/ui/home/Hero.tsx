"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, ReceiptText, Send, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { FadeInFn } from "./types";
import { SolanaLogo } from "@/components/landing/ChainLogos";

export function Hero({ fadeIn }: { fadeIn: FadeInFn }) {
  return (
    <section className="relative left-1/2 isolate z-10 -mt-[72px] min-h-[calc(100svh_+_72px)] w-screen -translate-x-1/2 overflow-hidden bg-[#070807] sm:-mt-[100px] sm:min-h-[calc(100svh_+_100px)]">
      <Image
        src="/assets/clearsig-hero-bg.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-[1.04] object-cover object-[64%_50%] opacity-90 sm:scale-[1.02] sm:object-[60%_56%] sm:opacity-95"
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
      <div className="relative z-10 mx-auto grid min-h-[calc(100svh_+_72px)] w-full max-w-[1600px] grid-cols-1 items-start gap-10 px-5 pb-16 pt-20 sm:min-h-[calc(100svh_+_100px)] sm:items-center sm:gap-12 sm:px-10 sm:pb-28 sm:pt-32 lg:grid-cols-12 lg:gap-10 lg:pb-36 lg:pt-36">
        {/* Left - copy */}
        <div className="relative mx-auto max-w-3xl text-center lg:col-span-7 lg:mx-0 lg:text-left">

          <motion.h1
            {...fadeIn(0.06)}
            className="landing-section-heading text-[clamp(3rem,8.4vw,7.25rem)] font-medium leading-[0.88] tracking-[-0.04em] text-white drop-shadow-[0_18px_50px_rgba(0,0,0,0.55)] sm:mt-7 sm:leading-[0.85] sm:tracking-[-0.05em]"
          >
            ClearSig
          </motion.h1>

          <motion.p
            {...fadeIn(0.1)}
            className="landing-section-heading mx-auto mt-5 max-w-2xl text-[clamp(2rem,4.4vw,4.4rem)] font-light leading-[0.96] text-white sm:mt-7 lg:mx-0"
          >
            Sign intents. <span className="italic-skew text-[#ccff00]">Not hex.</span>
          </motion.p>

          <motion.p
            {...fadeIn(0.15)}
            className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-white/68 sm:text-lg lg:mx-0"
          >
            Policy-driven shared wallets for teams,
            <br className="hidden sm:block" /> businesses, DAOs, and AI agents.
          </motion.p>

          <motion.div
            {...fadeIn(0.19)}
            className="mx-auto mt-5 flex max-w-xl flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-semibold text-white/84 sm:text-base lg:mx-0 lg:justify-start"
          >
            <span>One treasury.</span>
            <span>Multiple chains.</span>
            <span>Zero blind-signing.</span>
          </motion.div>

          <motion.div {...fadeIn(0.23)} className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-9 sm:gap-4 lg:justify-start">
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
    <div className="group relative mx-auto w-full max-w-[410px] [perspective:1500px] sm:max-w-[560px] lg:mx-0 lg:ml-auto">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.8rem] bg-[#ccff00]/[0.055] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 -bottom-8 h-16 rounded-full bg-black/80 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-4 -z-10 rounded-[2.2rem] bg-[#070908] shadow-[0_38px_80px_-44px_rgba(0,0,0,1)]"
        style={{
          transform: "rotateX(9deg) rotateY(-9deg) translate3d(28px, 30px, -74px)",
          transformStyle: "preserve-3d",
        }}
      />

      <div
        className="relative overflow-hidden rounded-[1.65rem] bg-[#0a0d0c]/98 p-2.5 shadow-[0_42px_110px_-58px_rgba(0,0,0,1)] sm:rounded-[2.1rem] sm:p-4"
        style={{
          transform: "rotateX(9deg) rotateY(-9deg) rotateZ(0.35deg) translateZ(28px)",
          transformStyle: "preserve-3d",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.14)_0%,transparent_23%,transparent_68%,rgba(204,255,0,0.08)_100%)] opacity-55"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 top-12 h-40 w-10 rounded-full bg-[#ccff00]/20 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-5 top-3 h-px bg-white/12"
        />

        <div
          className="relative rounded-[1.35rem] bg-[#111412] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.055),inset_0_-18px_40px_rgba(0,0,0,0.22)] sm:rounded-[1.75rem] sm:p-5"
          style={{ transform: "translateZ(34px)", transformStyle: "preserve-3d" }}
        >
          <div className="flex items-center justify-between gap-4" style={{ transform: "translateZ(46px)" }}>
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
            <section
              className="rounded-[1.15rem] bg-[#080a09] p-3 shadow-[0_22px_45px_-34px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,0.05)] sm:rounded-[1.35rem] sm:p-4"
              style={{ transform: "translateZ(64px)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-white/46">Send</p>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-[2.75rem] font-semibold leading-none tracking-[-0.06em] text-white drop-shadow-[0_10px_28px_rgba(204,255,0,0.08)] sm:text-[3.25rem]">
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

            <section
              className="hidden rounded-[1.35rem] bg-[#151a12] p-4 shadow-[0_22px_45px_-34px_rgba(0,0,0,1),inset_0_1px_0_rgba(204,255,0,0.07)] sm:block"
              style={{ transform: "translateZ(52px)" }}
            >
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

          <div
            className="mt-3 rounded-[1.15rem] bg-[#080a09] p-3 shadow-[0_22px_45px_-36px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,0.04)] sm:mt-4 sm:rounded-[1.35rem] sm:p-4"
            style={{ transform: "translateZ(50px)" }}
          >
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

          <div className="mt-3 flex items-center justify-between gap-3 sm:mt-4" style={{ transform: "translateZ(70px)" }}>
            <p className="hidden text-xs font-medium text-white/42 sm:block">
              Clear intent, policy checked, ready to sign.
            </p>
            <span className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#ccff00] px-5 text-sm font-bold text-black shadow-[0_18px_38px_-24px_rgba(204,255,0,0.95)] sm:min-h-11 sm:flex-none">
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
