"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Bot, Check, Lock, Send, ShieldCheck, Users } from "lucide-react";
import type { FadeInFn } from "./types";

export function AgentControlSection({ fadeIn }: { fadeIn: FadeInFn }) {
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
