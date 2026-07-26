"use client";

import { motion } from "framer-motion";
import { Check, Network, ReceiptText, Send, ShieldCheck, Users } from "lucide-react";
import type { FadeInFn } from "./types";

export function WhyClear({ fadeIn }: { fadeIn: FadeInFn }) {
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
