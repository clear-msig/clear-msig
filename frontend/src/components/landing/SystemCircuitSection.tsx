"use client";

// System circuit. A living blueprint of the whole stack, drawn as an
// animated SVG. Signal packets (glowing dots) travel along wires from
// the user's wallet to each destination chain.
//
// SVG was picked deliberately: viewBox handles every breakpoint for
// free, and animateMotion gives us smooth packet travel without any
// JavaScript per-frame work.

import { useId } from "react";
import { motion } from "framer-motion";
import { Bitcoin, Zap, Coins, ShieldCheck, Cpu, Fingerprint } from "lucide-react";

interface CircuitNode {
  id: string;
  x: number;
  y: number;
  label: string;
  sub: string;
  Icon: typeof ShieldCheck;
  accent: "green" | "cyan" | "warm" | "orange" | "violet";
}

// Layout is designed against an 800 x 440 viewBox. Nodes form a
// left-to-right flow that fans out to destination chains.
const NODES: CircuitNode[] = [
  { id: "wallet", x: 90, y: 220, label: "Your wallet", sub: "signs intent", Icon: Fingerprint, accent: "green" },
  { id: "policy", x: 290, y: 220, label: "Multisig policy", sub: "on-chain verify", Icon: ShieldCheck, accent: "green" },
  { id: "mpc", x: 500, y: 220, label: "Ika MPC", sub: "threshold signing", Icon: Cpu, accent: "cyan" },
  { id: "eth", x: 720, y: 90, label: "Ethereum", sub: "EIP-1559", Icon: Zap, accent: "violet" },
  { id: "btc", x: 720, y: 220, label: "Bitcoin", sub: "P2WPKH", Icon: Bitcoin, accent: "orange" },
  { id: "sol", x: 720, y: 350, label: "Solana", sub: "native CPI", Icon: Coins, accent: "green" },
];

const LEGS: Array<{ id: string; d: string; delay: number; tone: "green" | "cyan" }> = [
  { id: "wallet-policy", d: "M 128,220 L 252,220", delay: 0, tone: "green" },
  { id: "policy-mpc", d: "M 328,220 L 462,220", delay: 0.6, tone: "green" },
  { id: "mpc-eth", d: "M 538,220 C 600,220 620,90 682,90", delay: 1.2, tone: "cyan" },
  { id: "mpc-btc", d: "M 538,220 L 682,220", delay: 1.35, tone: "cyan" },
  { id: "mpc-sol", d: "M 538,220 C 600,220 620,350 682,350", delay: 1.5, tone: "cyan" },
];

// Comet head + a short fading tail. To get the tail effect cheaply we
// render two motion-animated circles per leg, offset in time.
const TAIL_OFFSETS = [0, 0.08];

export function SystemCircuitSection() {
  const glowId = useId();
  const gridId = useId();
  const greenGradId = useId();
  const cyanGradId = useId();

  return (
    <section id="circuit" className="w-full">
      <div className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-black/70">
          <Cpu size={11} /> The system, live
        </span>
        <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-black text-balance sm:text-4xl lg:text-5xl">
          One signature lights up every wire.
        </h2>
        <p className="mt-3 text-sm text-black/60 sm:text-base">
          A living blueprint of the whole system. Watch the packets travel
          from your wallet, through the on-chain policy, out to every
          destination chain on earth.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        className="relative mt-10 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black shadow-card-dark sm:rounded-[2.25rem]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-brand-green/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl"
        />

        <div className="relative z-10 mx-auto w-full max-w-5xl px-2 py-3 sm:px-6 sm:py-8">
          <svg
            role="img"
            aria-label="Clear-MSIG signal path: your wallet signs an intent, the on-chain policy verifies every approval, and the Ika MPC network produces native signatures for Ethereum, Bitcoin, and Solana."
            viewBox="0 0 800 440"
            preserveAspectRatio="xMidYMid meet"
            className="w-full"
          >
            <defs>
              <pattern
                id={gridId}
                x="0"
                y="0"
                width="32"
                height="32"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 32 0 L 0 0 0 32"
                  fill="none"
                  stroke="rgba(114,185,13,0.06)"
                  strokeWidth="1"
                />
              </pattern>
              <linearGradient id={greenGradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="55%" stopColor="#72b90d" />
                <stop offset="100%" stopColor="#a3e635" />
              </linearGradient>
              <linearGradient id={cyanGradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#72b90d" />
                <stop offset="60%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#a3e635" />
              </linearGradient>
              <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" />
              </filter>
            </defs>

            {/* circuit-board grid */}
            <rect width="800" height="440" fill={`url(#${gridId})`} />

            {/* leg wires */}
            {LEGS.map((leg) => (
              <path
                key={leg.id + "-wire"}
                d={leg.d}
                fill="none"
                stroke={leg.tone === "green" ? `url(#${greenGradId})` : `url(#${cyanGradId})`}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeOpacity="0.55"
              />
            ))}

            {/* leg packets (comet head + short tail) */}
            {LEGS.map((leg) =>
              TAIL_OFFSETS.map((offset, i) => (
                <circle
                  key={`${leg.id}-packet-${i}`}
                  r={i === 0 ? 4 : 2.5}
                  fill={leg.tone === "green" ? "#a3e635" : "#7dd3fc"}
                  opacity={i === 0 ? 0.95 : 0.45}
                  style={{ filter: `url(#${glowId})` }}
                >
                  <animateMotion
                    path={leg.d}
                    dur="2.4s"
                    begin={`${leg.delay + offset}s`}
                    repeatCount="indefinite"
                    rotate="auto"
                    keyTimes="0;1"
                    keyPoints="0;1"
                    calcMode="linear"
                  />
                </circle>
              ))
            )}

            {/* nodes (drawn last so packets pass beneath the labels) */}
            {NODES.map((n) => (
              <NodeGlyph key={n.id} node={n} />
            ))}
          </svg>
        </div>
      </motion.div>
    </section>
  );
}

function NodeGlyph({ node }: { node: CircuitNode }) {
  const width = 76;
  const height = 76;
  const x = node.x - width / 2;
  const y = node.y - height / 2;

  const color =
    node.accent === "cyan"
      ? "#22d3ee"
      : node.accent === "orange"
      ? "#fbbf24"
      : node.accent === "violet"
      ? "#c4b5fd"
      : node.accent === "warm"
      ? "#fb923c"
      : "#a3e635";

  const bg =
    node.accent === "cyan"
      ? "rgba(34,211,238,0.08)"
      : node.accent === "orange"
      ? "rgba(251,191,36,0.08)"
      : node.accent === "violet"
      ? "rgba(196,181,253,0.08)"
      : "rgba(163,230,53,0.08)";

  return (
    <g>
      <circle
        cx={node.x}
        cy={node.y}
        r={48}
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeOpacity="0.18"
      >
        <animate
          attributeName="r"
          values="44;54;44"
          dur="3.2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="stroke-opacity"
          values="0.18;0.05;0.18"
          dur="3.2s"
          repeatCount="indefinite"
        />
      </circle>

      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={18}
        fill={bg}
        stroke={color}
        strokeWidth="1.25"
        strokeOpacity="0.55"
      />

      <foreignObject x={node.x - 14} y={node.y - 22} width={28} height={28}>
        <div
          style={{ width: 28, height: 28, color, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <node.Icon size={20} />
        </div>
      </foreignObject>

      <text
        x={node.x}
        y={node.y + 10}
        textAnchor="middle"
        fill="#ffffff"
        fontSize="11"
        fontWeight="700"
        style={{ fontFamily: "var(--font-display), sans-serif", letterSpacing: "-0.01em" }}
      >
        {node.label}
      </text>
      <text
        x={node.x}
        y={node.y + 24}
        textAnchor="middle"
        fill="rgba(255,255,255,0.5)"
        fontSize="9"
        fontWeight="500"
        style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {node.sub}
      </text>
    </g>
  );
}
