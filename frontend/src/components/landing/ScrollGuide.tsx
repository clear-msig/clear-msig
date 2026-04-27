"use client";

// Scroll guide. A "signal thread" on the right edge that pulls the
// user's eye down toward the vault at the bottom of the landing page.
//
// Design intent:
//   * A thin vertical line that fills as scroll progresses, so the
//     user sees a visual reward for scrolling.
//   * A luminous dot that rides the line, so the eye tracks motion.
//   * A lock at the top, a vault at the bottom. The vault dims when
//     far from it and glows brighter as the user gets closer, so the
//     lower the user scrolls, the more inviting the destination
//     becomes.
//   * On mobile the rail is replaced by a bottom-centered pill with
//     the same narrative and a smooth-scroll link to the vault.
//
// This component is purely decorative. It never steals the tab order
// (tabindex=-1) and respects prefers-reduced-motion by rendering a
// static end-state instead of animating.

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { KeyRound, Lock, Unlock, ChevronsDown } from "lucide-react";

const VAULT_ID = "connect";

function scrollToVault() {
  const node = document.getElementById(VAULT_ID);
  if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ScrollGuide() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();

  // Smoothed progress so the indicator glides instead of snapping.
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 22,
    mass: 0.35,
  });

  const [nearVault, setNearVault] = useState(false);
  const lastValRef = useRef(0);

  useEffect(() => {
    const unsub = progress.on("change", (v) => {
      lastValRef.current = v;
      setNearVault(v > 0.82);
    });
    return unsub;
  }, [progress]);

  // Rail geometry.
  const fillHeight = useTransform(progress, [0, 1], ["0%", "100%"]);
  const dotY = useTransform(progress, [0, 1], ["0%", "100%"]);
  const vaultGlow = useTransform(progress, [0.4, 1], [0.35, 1]);
  const vaultScale = useTransform(progress, [0.4, 1], [1, 1.1]);

  if (reduce) return null;

  return (
    <>
      {/* Desktop rail. Fixed at the right edge. */}
      <div
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none fixed right-5 top-1/2 z-[40] hidden h-[62vh] -translate-y-1/2 flex-col items-center lg:flex"
      >
        <RailCap icon={<Lock size={12} />} tone="muted" />

        <div className="relative my-2 flex-1 overflow-hidden rounded-full">
          <span className="absolute inset-0 w-[2px] -translate-x-1/2 bg-black/10" />
          <motion.span
            style={{ height: fillHeight }}
            className="absolute left-1/2 top-0 w-[2px] -translate-x-1/2 bg-gradient-to-b from-brand-emerald via-brand-green to-brand-green-bright shadow-[0_0_14px_rgba(114,185,13,0.55)]"
          />
          <motion.span
            style={{ top: dotY }}
            className="pointer-events-auto absolute left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-brand-green-bright shadow-[0_0_18px_rgba(163,230,53,0.7)]"
            onClick={scrollToVault}
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-green-bright/50" />
          </motion.span>
        </div>

        <motion.div
          style={{ opacity: vaultGlow, scale: vaultScale }}
          className="pointer-events-auto cursor-pointer"
          onClick={scrollToVault}
        >
          <RailCap
            icon={nearVault ? <Unlock size={14} /> : <KeyRound size={14} />}
            tone={nearVault ? "bright" : "green"}
          />
        </motion.div>

        <span className="mt-3 whitespace-nowrap rotate-180 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-black/40 [writing-mode:vertical-rl]">
          follow the signal
        </span>
      </div>

      {/* Mobile pill. Bottom-centered, fades out near the vault. */}
      <MobileScrollPill progress={progress} onJumpToVault={scrollToVault} />
    </>
  );
}

function RailCap({
  icon,
  tone,
}: {
  icon: React.ReactNode;
  tone: "muted" | "green" | "bright";
}) {
  const base =
    "relative flex h-8 w-8 items-center justify-center rounded-full border transition-all";
  const toneClass =
    tone === "muted"
      ? "border-black/15 bg-white/80 text-black/60 shadow-sm"
      : tone === "green"
      ? "border-brand-green/40 bg-black text-brand-green shadow-glow"
      : "border-brand-green-bright/70 bg-black text-brand-green-bright shadow-[0_0_32px_rgba(163,230,53,0.6)]";
  return <div className={`${base} ${toneClass}`}>{icon}</div>;
}

function MobileScrollPill({
  progress,
  onJumpToVault,
}: {
  progress: ReturnType<typeof useSpring>;
  onJumpToVault: () => void;
}) {
  const [stage, setStage] = useState<"intro" | "mid" | "near" | "hidden">("intro");

  useEffect(() => {
    const unsub = progress.on("change", (v) => {
      if (v < 0.05) setStage("intro");
      else if (v < 0.6) setStage("mid");
      else if (v < 0.92) setStage("near");
      else setStage("hidden");
    });
    return unsub;
  }, [progress]);

  if (stage === "hidden") return null;

  const copy =
    stage === "intro"
      ? "start the tour"
      : stage === "mid"
      ? "follow the signal"
      : "the vault is close";

  return (
    <motion.button
      type="button"
      onClick={onJumpToVault}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-x-0 bottom-5 z-[40] mx-auto flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white/85 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-black/70 shadow-card-shadow backdrop-blur lg:hidden"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand-green/70" />
        <span className="relative h-2 w-2 rounded-full bg-brand-green" />
      </span>
      {copy}
      <ChevronsDown size={12} className="text-brand-green" />
    </motion.button>
  );
}
