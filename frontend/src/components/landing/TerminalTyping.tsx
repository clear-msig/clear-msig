"use client";

// GSAP-powered terminal-typing animation. Cycles through a list of
// example clear-signed messages, types each one character by character,
// holds, then fades in a green verified chip.
//
// Built from scratch instead of typewriter libs so we get:
//   - One timeline, no runtime allocations per keystroke.
//   - `prefers-reduced-motion` pre-renders the final state.
//   - Natural looping with variable hold times per frame.

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { CheckCircle2 } from "lucide-react";

interface Frame {
  /// Key headline rendered with slight whitespace discipline, mono.
  message: string;
  /// Optional subtitle shown below after the message settles.
  chainLabel: string;
}

const DEFAULT_FRAMES: Frame[] = [
  {
    message:
      "expires 2026-04-20 18:00: approve transfer 0.5 ETH to 0x71Ca...Ae23 | wallet: treasury proposal: 42",
    chainLabel: "Ethereum · EIP-1559",
  },
  {
    message:
      "expires 2026-04-20 18:00: approve send 2500000 sats to bc1q-pkh:0x9b...fA5 | wallet: treasury proposal: 43",
    chainLabel: "Bitcoin · P2WPKH",
  },
  {
    message:
      "expires 2026-04-20 18:00: approve transfer 12 lamports to 7xP3...Rq2 | wallet: treasury proposal: 44",
    chainLabel: "Solana",
  },
];

export function TerminalTyping({ frames = DEFAULT_FRAMES }: { frames?: Frame[] }) {
  const msgRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Render the first frame fully, skip animation.
      if (msgRef.current) msgRef.current.textContent = frames[0].message;
      if (labelRef.current) labelRef.current.textContent = frames[0].chainLabel;
      if (chipRef.current) chipRef.current.style.opacity = "1";
      return;
    }

    const ctx = gsap.context(() => {
      // Caret blink: single independent tween so it does not reset on
      // every frame swap.
      gsap.to(caretRef.current, {
        opacity: 0,
        duration: 0.5,
        repeat: -1,
        yoyo: true,
        ease: "power1.inOut",
      });

      const master = gsap.timeline({ repeat: -1, repeatDelay: 0 });

      for (const frame of frames) {
        const proxy = { count: 0 };
        master
          .set(msgRef.current, { textContent: "" })
          .set(chipRef.current, { opacity: 0 })
          .set(labelRef.current, { textContent: frame.chainLabel })
          .to(proxy, {
            count: frame.message.length,
            duration: Math.max(1.8, frame.message.length * 0.02),
            ease: "none",
            onUpdate: () => {
              if (msgRef.current) {
                msgRef.current.textContent = frame.message.slice(
                  0,
                  Math.floor(proxy.count)
                );
              }
            },
          })
          .to(chipRef.current, { opacity: 1, duration: 0.3 })
          .to({}, { duration: 2.4 }); // hold
      }
    });
    return () => ctx.revert();
  }, [frames]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 shadow-card-dark">
      {/* subtle scanline overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[20%] bg-white/[0.03] [animation:scanLine_4s_linear_infinite]"
      />
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand-green/60" />
        <span
          ref={labelRef}
          className="ml-3 text-[10px] font-semibold uppercase tracking-widest text-white/40"
        >
          {frames[0].chainLabel}
        </span>
      </div>
      <div className="mt-4 flex items-start gap-2 font-mono text-[13px] leading-relaxed text-brand-green">
        <span className="select-none text-brand-green/50">$</span>
        <div className="flex-1 break-words">
          <span ref={msgRef} className="text-brand-green-bright" />
          <span
            ref={caretRef}
            className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[2px] bg-brand-green-bright align-middle"
          />
        </div>
      </div>
      <div
        ref={chipRef}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-green/15 px-3 py-1 text-[11px] font-semibold text-brand-green opacity-0"
      >
        <CheckCircle2 size={12} /> verified by on-chain policy
      </div>
    </div>
  );
}
