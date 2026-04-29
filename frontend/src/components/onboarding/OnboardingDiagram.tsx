"use client";

// Compact "one signature → every chain" diagram shown on slide 2 of
// the onboarding walkthrough. A trimmed-down sibling of
// SystemCircuitSection on the landing page — same conceptual graph
// (wallet → policy → Ika MPC → SOL/ETH/BTC) but sized for a modal
// (white surface, ~280px tall) and with calmer animations so it sits
// behind copy without competing for attention.

import { useId } from "react";
import { motion } from "framer-motion";
import { Bitcoin, Coins, Cpu, Fingerprint, ShieldCheck, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
  Icon: LucideIcon;
  tone: "green" | "cyan" | "violet" | "orange";
}

const NODES: Node[] = [
  { id: "wallet", x: 60, y: 110, label: "You", Icon: Fingerprint, tone: "green" },
  { id: "policy", x: 195, y: 110, label: "Multisig", Icon: ShieldCheck, tone: "green" },
  { id: "mpc", x: 330, y: 110, label: "Ika MPC", Icon: Cpu, tone: "cyan" },
  { id: "eth", x: 470, y: 35, label: "ETH", Icon: Zap, tone: "violet" },
  { id: "btc", x: 470, y: 110, label: "BTC", Icon: Bitcoin, tone: "orange" },
  { id: "sol", x: 470, y: 185, label: "SOL", Icon: Coins, tone: "green" },
];

const LEGS = [
  { id: "wallet-policy", d: "M 88,110 L 167,110", delay: 0, tone: "green" as const },
  { id: "policy-mpc", d: "M 223,110 L 302,110", delay: 0.4, tone: "green" as const },
  { id: "mpc-eth", d: "M 358,110 C 400,110 410,35 442,35", delay: 0.8, tone: "cyan" as const },
  { id: "mpc-btc", d: "M 358,110 L 442,110", delay: 0.95, tone: "cyan" as const },
  { id: "mpc-sol", d: "M 358,110 C 400,110 410,185 442,185", delay: 1.1, tone: "cyan" as const },
];

const TONE_FILL: Record<Node["tone"], string> = {
  green: "fill-brand-green/15 stroke-brand-green/40",
  cyan: "fill-cyan-400/15 stroke-cyan-500/40",
  violet: "fill-violet-400/15 stroke-violet-500/40",
  orange: "fill-amber-400/15 stroke-amber-500/40",
};

const TONE_TEXT: Record<Node["tone"], string> = {
  green: "text-brand-emerald",
  cyan: "text-cyan-600",
  violet: "text-violet-600",
  orange: "text-amber-700",
};

export function OnboardingDiagram() {
  const greenGradId = useId();
  const cyanGradId = useId();

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-black/10 bg-gradient-to-br from-emerald-50/60 via-white to-cyan-50/40 p-2">
      <svg
        role="img"
        aria-label="Clear-MSIG signal path: you sign one intent, the multisig verifies it, the Ika MPC network signs for every destination chain."
        viewBox="0 0 540 240"
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
      >
        <defs>
          <linearGradient id={greenGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
          <linearGradient id={cyanGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>

        {LEGS.map((leg) => (
          <g key={leg.id}>
            <path
              d={leg.d}
              fill="none"
              stroke={leg.tone === "green" ? `url(#${greenGradId})` : `url(#${cyanGradId})`}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeOpacity="0.5"
            />
            <motion.circle
              r="2.5"
              fill={leg.tone === "green" ? "#16a34a" : "#22d3ee"}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 2.4,
                delay: leg.delay,
                repeat: Infinity,
                repeatDelay: 1.6,
                ease: "easeInOut",
              }}
            >
              <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${leg.delay}s`}>
                <mpath href={`#path-${leg.id}`} />
              </animateMotion>
            </motion.circle>
            <path id={`path-${leg.id}`} d={leg.d} fill="none" stroke="none" />
          </g>
        ))}

        {NODES.map((n, i) => (
          <motion.g
            key={n.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <circle cx={n.x} cy={n.y} r="22" className={TONE_FILL[n.tone]} strokeWidth="1.5" />
            <foreignObject x={n.x - 11} y={n.y - 11} width="22" height="22">
              <div className={`flex h-full w-full items-center justify-center ${TONE_TEXT[n.tone]}`}>
                <n.Icon size={14} />
              </div>
            </foreignObject>
            <text
              x={n.x}
              y={n.y + 38}
              textAnchor="middle"
              className="fill-black/70 text-[10px] font-semibold uppercase tracking-wider"
            >
              {n.label}
            </text>
          </motion.g>
        ))}
      </svg>
    </div>
  );
}
