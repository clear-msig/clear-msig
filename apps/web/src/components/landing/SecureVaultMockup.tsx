"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Fingerprint, KeyRound, Laptop2, Lock, ShieldCheck, Smartphone, Unlock, Usb } from "lucide-react";
import clsx from "clsx";

type Phase = 0 | 1 | 2 | 3 | 4;

const PHASE_DURATIONS_MS: Record<Phase, number> = {
  0: 1100, // sealed / idle
  1: 1000, // device 1 (iPhone) signs
  2: 1000, // device 2 (MacBook) signs
  3: 1000, // threshold met flash
  4: 2400, // ready hold
};

export function SecureVaultMockup() {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.35 });
  const [phase, setPhase] = useState<Phase>(0);
  const animate = inView && !reduce;

  // Phase loop. Single setTimeout chain so phases hand off cleanly;
  // a re-mount on inView restart guarantees the loop resumes when
  // the user scrolls back into view. Reduced-motion locks the
  // mockup at the final "ready" frame.
  useEffect(() => {
    if (!animate) {
      setPhase(reduce ? 4 : 0);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (current: Phase) => {
      if (cancelled) return;
      setPhase(current);
      const next = ((current + 1) % 5) as Phase;
      timer = setTimeout(() => tick(next), PHASE_DURATIONS_MS[current]);
    };
    tick(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [animate, reduce]);

  // Device states derived from phase. iPhone approves at phase 1,
  // MacBook at phase 2; passkey + ledger never sign in the demo
  // loop. They show idle / pending to imply more capacity in the
  // quorum than is being used.
  const phoneApproved = phase >= 1;
  const laptopApproved = phase >= 2;
  const passkeyPending = phase >= 1 && phase < 3;
  const thresholdMet = phase >= 3;

  return (
    <div
      ref={rootRef}
      className="relative mx-auto w-full max-w-[520px] lg:ml-auto"
    >
      {/* Backdrop blooms. Sit behind the card so it appears to
          bloom out of light. Two layered radials (lime top-left,
          emerald bottom-right) blurred heavily. */}
      <div
        aria-hidden="true"
        className="absolute -inset-14 -z-10 rounded-[3rem] opacity-70"
        style={{
          background:
            "radial-gradient(circle at 28% 22%, rgba(204, 255, 0, 0.20) 0%, rgba(204, 255, 0, 0) 60%)",
          filter: "blur(80px)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -inset-14 -z-10 rounded-[3rem] opacity-55"
        style={{
          background:
            "radial-gradient(circle at 82% 80%, rgba(16, 185, 129, 0.22) 0%, rgba(16, 185, 129, 0) 65%)",
          filter: "blur(90px)",
        }}
      />

      <div className="hero-mockup-card relative flex flex-col overflow-hidden rounded-[1.75rem] p-4 sm:rounded-[2rem] sm:p-6">
        {/* Specular */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[1.75rem] sm:rounded-[2rem]"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(204, 255, 0, 0.06) 100%)",
          }}
        />

        {/* Faint binary-rain backdrop inside the card. Pure CSS. A
            grid of vertically-drifting numeric glyphs. Only renders
            when motion is allowed and the card is in view. */}
        {animate && <CardCipherRain />}

        {/* Header strip. Wraps gracefully on narrow widths so the
            status pill drops to its own row instead of squeezing. */}
        <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#ccff00]/12 text-[#ccff00] ring-1 ring-[#ccff00]/30">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] font-medium leading-none text-white/90">
                Personal vault
              </span>
              <span className="mt-1 truncate font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/45">
                ika dwallet · curve25519
              </span>
            </div>
          </div>
          <PhaseStatusPill phase={phase} reduce={reduce} />
        </div>

        {/* Orbit core. Fixed mobile size so labels stay readable;
            grows to 400px on larger screens. Sized with min(...) so
            it never overflows the card. */}
        <div
          className="relative mx-auto mt-6 w-full sm:mt-7"
          style={{
            maxWidth: "400px",
            aspectRatio: "1 / 1",
          }}
        >
          <VaultOrbit
            phase={phase}
            animate={animate}
            phoneApproved={phoneApproved}
            laptopApproved={laptopApproved}
            passkeyPending={passkeyPending}
            thresholdMet={thresholdMet}
          />
          {/* HTML overlay labels. Fixed CSS font sizes regardless
              of orbit scale, so they stay readable on mobile. */}
          <OrbitLabels
            phoneApproved={phoneApproved}
            laptopApproved={laptopApproved}
            passkeyPending={passkeyPending}
          />
        </div>

        {/* Signature output strip */}
        <SignatureStrip thresholdMet={thresholdMet} animate={animate} />

        {/* Footer threshold line. Flex-wrap so the threshold count
            drops to its own line on narrow widths rather than
            colliding with the label. */}
        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <motion.span
              animate={
                thresholdMet
                  ? { scale: [1, 1.15, 1] }
                  : { scale: 1 }
              }
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className={clsx(
                "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                thresholdMet
                  ? "bg-[#ccff00]/20 text-[#ccff00]"
                  : "bg-white/[0.06] text-white/55",
              )}
            >
              <KeyRound className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
            </motion.span>
            <span className="truncate font-mono-tech text-[10px] uppercase tracking-[0.22em] text-white/55">
              {thresholdMet ? "Recovery ready" : "Awaiting quorum"}
            </span>
          </div>
          <ThresholdCount approved={(phoneApproved ? 1 : 0) + (laptopApproved ? 1 : 0)} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Orbital diagram. Central shield core + 4 device nodes on a ring,
 *  energy beams from each device to the core. SVG-driven.
 * ───────────────────────────────────────────────────────────────── */

const ORBIT_VIEW = 400;
const ORBIT_CENTER = ORBIT_VIEW / 2;
const ORBIT_RADIUS = 142; // device nodes
const RING_RADIUS = 110; // inner ring track
const CORE_RADIUS = 46;

interface OrbitNode {
  id: "phone" | "laptop" | "passkey" | "ledger";
  label: string;
  sub: string;
  angleDeg: number;
  Icon: typeof Smartphone;
}

const ORBIT_NODES: OrbitNode[] = [
  { id: "phone", label: "iPhone", sub: "Face ID", angleDeg: -135, Icon: Smartphone },
  { id: "laptop", label: "MacBook", sub: "Touch ID", angleDeg: -45, Icon: Laptop2 },
  { id: "passkey", label: "Passkey", sub: "WebAuthn", angleDeg: 135, Icon: Fingerprint },
  { id: "ledger", label: "Ledger", sub: "Hardware", angleDeg: 45, Icon: Usb },
];

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const r = (angleDeg * Math.PI) / 180;
  return {
    x: ORBIT_CENTER + Math.cos(r) * radius,
    y: ORBIT_CENTER + Math.sin(r) * radius,
  };
}

function VaultOrbit({
  phase,
  animate,
  phoneApproved,
  laptopApproved,
  passkeyPending,
  thresholdMet,
}: {
  phase: Phase;
  animate: boolean;
  phoneApproved: boolean;
  laptopApproved: boolean;
  passkeyPending: boolean;
  thresholdMet: boolean;
}) {
  const uid = useId();
  const limeId = `${uid}-lime`;
  const ambientId = `${uid}-ambient`;
  const ringConicId = `${uid}-conic`;

  // Per-node signing state
  const nodeStates: Record<OrbitNode["id"], "idle" | "signing" | "approved" | "pending"> = {
    phone: phase === 1 ? "signing" : phoneApproved ? "approved" : "idle",
    laptop: phase === 2 ? "signing" : laptopApproved ? "approved" : "idle",
    passkey: passkeyPending ? "pending" : "idle",
    ledger: "idle",
  };

  return (
    <svg viewBox={`0 0 ${ORBIT_VIEW} ${ORBIT_VIEW}`} className="h-full w-full">
      <defs>
        <linearGradient id={limeId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ccff00" stopOpacity="1" />
          <stop offset="100%" stopColor="#a3d600" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id={ambientId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(204,255,0,0.22)" />
          <stop offset="100%" stopColor="rgba(204,255,0,0)" />
        </radialGradient>
        <linearGradient id={ringConicId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(204,255,0,0.5)" />
          <stop offset="50%" stopColor="rgba(204,255,0,0)" />
          <stop offset="100%" stopColor="rgba(204,255,0,0.5)" />
        </linearGradient>
      </defs>

      {/* Ambient inner disc. Intensifies on threshold-met */}
      <motion.circle
        cx={ORBIT_CENTER}
        cy={ORBIT_CENTER}
        r={RING_RADIUS - 4}
        fill={`url(#${ambientId})`}
        animate={
          animate
            ? {
                opacity: thresholdMet ? 1 : 0.55,
                scale: thresholdMet ? 1.08 : 1,
              }
            : undefined
        }
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: `${ORBIT_CENTER}px ${ORBIT_CENTER}px` }}
      />

      {/* Concentric tracker ring (faint) */}
      <circle
        cx={ORBIT_CENTER}
        cy={ORBIT_CENTER}
        r={RING_RADIUS}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="1"
        strokeDasharray="2 4"
      />

      {/* Outer rotating sweep ring. A thin lime arc spinning around
          the core. Continuous animation, suspended on reduced-motion. */}
      {animate && (
        <motion.g
          style={{ transformOrigin: `${ORBIT_CENTER}px ${ORBIT_CENTER}px` }}
          animate={{ rotate: 360 }}
          transition={{ duration: 14, ease: "linear", repeat: Infinity }}
        >
          <circle
            cx={ORBIT_CENTER}
            cy={ORBIT_CENTER}
            r={ORBIT_RADIUS - 24}
            fill="none"
            stroke={`url(#${ringConicId})`}
            strokeWidth="1.5"
            strokeDasharray="60 600"
            strokeLinecap="round"
            opacity={0.55}
          />
        </motion.g>
      )}

      {/* Device → core beams */}
      {ORBIT_NODES.map((node) => {
        const start = polar(node.angleDeg, ORBIT_RADIUS - 28);
        const end = polar(node.angleDeg, CORE_RADIUS + 4);
        const state = nodeStates[node.id];
        return (
          <Beam
            key={node.id}
            startX={start.x}
            startY={start.y}
            endX={end.x}
            endY={end.y}
            state={state}
            limeId={limeId}
            animate={animate}
          />
        );
      })}

      {/* Central core. Concentric rings + shield + heartbeat */}
      <VaultCore
        thresholdMet={thresholdMet}
        animate={animate}
        limeId={limeId}
      />

      {/* Device nodes */}
      {ORBIT_NODES.map((node) => {
        const p = polar(node.angleDeg, ORBIT_RADIUS);
        return (
          <DeviceNode
            key={node.id}
            node={node}
            cx={p.x}
            cy={p.y}
            state={nodeStates[node.id]}
            animate={animate}
          />
        );
      })}

      {/* Threshold-met flash ring */}
      <AnimatePresence>
        {animate && phase === 3 && (
          <motion.circle
            key="flash"
            cx={ORBIT_CENTER}
            cy={ORBIT_CENTER}
            r={CORE_RADIUS}
            fill="none"
            stroke="#ccff00"
            strokeWidth="2"
            initial={{ opacity: 0.9, scale: 1 }}
            animate={{ opacity: 0, scale: 2.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: `${ORBIT_CENTER}px ${ORBIT_CENTER}px` }}
          />
        )}
      </AnimatePresence>
    </svg>
  );
}

/* ── Beam from a device node to the core. Static base line + a
 * traveling lime "packet" that rides the line while signing, and
 * a steady-lit line after approval. ─────────────────────────── */

function Beam({
  startX,
  startY,
  endX,
  endY,
  state,
  limeId,
  animate,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  state: "idle" | "signing" | "approved" | "pending";
  limeId: string;
  animate: boolean;
}) {
  const length = Math.hypot(endX - startX, endY - startY);
  const stroke =
    state === "approved" || state === "signing"
      ? `url(#${limeId})`
      : state === "pending"
        ? "rgba(204,255,0,0.4)"
        : "rgba(255,255,255,0.08)";
  const opacity =
    state === "idle" ? 0.6 : state === "pending" ? 0.7 : 1;

  return (
    <g>
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={stroke}
        strokeWidth={state === "approved" || state === "signing" ? 1.6 : 1}
        strokeLinecap="round"
        opacity={opacity}
        style={{
          transition: "stroke 400ms ease, opacity 400ms ease",
        }}
      />
      {/* Traveling pulse. A short dashed segment that rides the
          line during signing. Implemented by animating dashoffset
          on a 6-unit dash riding a 0-unit-long stroke. */}
      {animate && (state === "signing" || state === "pending") && (
        <motion.line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke="#ccff00"
          strokeWidth={state === "signing" ? 2.6 : 1.6}
          strokeLinecap="round"
          strokeDasharray={`6 ${length}`}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: -6 }}
          transition={{
            duration: state === "signing" ? 0.7 : 1.2,
            ease: "linear",
            repeat: Infinity,
          }}
          style={{ filter: "drop-shadow(0 0 4px rgba(204,255,0,0.7))" }}
        />
      )}
    </g>
  );
}

/* ── Vault core. Concentric rings + shield + heartbeat. ───── */

function VaultCore({
  thresholdMet,
  animate,
  limeId,
}: {
  thresholdMet: boolean;
  animate: boolean;
  limeId: string;
}) {
  return (
    <g>
      {/* Heartbeat ripple ring. Pulses outward continuously */}
      {animate && (
        <motion.circle
          cx={ORBIT_CENTER}
          cy={ORBIT_CENTER}
          r={CORE_RADIUS}
          fill="none"
          stroke="#ccff00"
          strokeWidth="1"
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.4, 1] }}
          transition={{ duration: 2.4, ease: "easeOut", repeat: Infinity }}
          style={{ transformOrigin: `${ORBIT_CENTER}px ${ORBIT_CENTER}px` }}
        />
      )}

      {/* Core disc */}
      <circle
        cx={ORBIT_CENTER}
        cy={ORBIT_CENTER}
        r={CORE_RADIUS}
        fill="#0c0c0c"
        stroke="rgba(204,255,0,0.35)"
        strokeWidth="1"
      />

      {/* Inner highlight ring */}
      <motion.circle
        cx={ORBIT_CENTER}
        cy={ORBIT_CENTER}
        r={CORE_RADIUS - 6}
        fill="none"
        stroke={`url(#${limeId})`}
        strokeWidth="1.2"
        animate={animate ? { opacity: thresholdMet ? [0.9, 1, 0.9] : 0.55 } : undefined}
        transition={{ duration: 1.4, repeat: Infinity }}
      />

      {/* Lock/unlock icon. Switches at threshold-met */}
      <foreignObject
        x={ORBIT_CENTER - 18}
        y={ORBIT_CENTER - 18}
        width={36}
        height={36}
      >
        <div className="flex h-full w-full items-center justify-center text-[#ccff00]">
          <AnimatePresence mode="wait" initial={false}>
            {thresholdMet ? (
              <motion.span
                key="unlock"
                initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className={animate ? "amount-glow" : undefined}
              >
                <Unlock className="h-7 w-7" strokeWidth={1.85} aria-hidden="true" />
              </motion.span>
            ) : (
              <motion.span
                key="lock"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <Lock className="h-6 w-6 text-white/80" strokeWidth={1.85} aria-hidden="true" />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </foreignObject>
    </g>
  );
}

/* ── A device node on the orbit ring. Renders an icon disc + a
 * floating label below. State-driven glow + scale. ─────────── */

function DeviceNode({
  node,
  cx,
  cy,
  state,
  animate,
}: {
  node: OrbitNode;
  cx: number;
  cy: number;
  state: "idle" | "signing" | "approved" | "pending";
  animate: boolean;
}) {
  const nodeRadius = 24;
  const stroke =
    state === "approved" || state === "signing"
      ? "#ccff00"
      : state === "pending"
        ? "rgba(204,255,0,0.55)"
        : "rgba(255,255,255,0.16)";
  const iconColor =
    state === "approved" || state === "signing"
      ? "#ccff00"
      : state === "pending"
        ? "rgba(204,255,0,0.8)"
        : "rgba(235,235,235,0.7)";

  return (
    <g>
      {/* Approval halo */}
      {animate && (state === "signing" || state === "approved") && (
        <motion.circle
          cx={cx}
          cy={cy}
          r={nodeRadius}
          fill="none"
          stroke="#ccff00"
          strokeWidth="1"
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 1.8 }}
          transition={{
            duration: state === "signing" ? 0.9 : 1.4,
            ease: "easeOut",
            repeat: Infinity,
          }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />
      )}

      <motion.circle
        cx={cx}
        cy={cy}
        r={nodeRadius}
        fill="#0c0c0c"
        stroke={stroke}
        strokeWidth="1.3"
        animate={
          animate
            ? {
                scale:
                  state === "approved" || state === "signing"
                    ? 1.08
                    : 1,
              }
            : undefined
        }
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          transition: "stroke 400ms ease",
        }}
      />

      <foreignObject
        x={cx - 12}
        y={cy - 12}
        width={24}
        height={24}
      >
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ color: iconColor, transition: "color 400ms ease" }}
        >
          <node.Icon className="h-[18px] w-[18px]" strokeWidth={1.85} aria-hidden="true" />
        </div>
      </foreignObject>
    </g>
  );
}

/* ─────────────────────────────────────────────────────────────────
 *  Orbit labels. HTML overlay positioned in the same coordinate
 *  space as the SVG so labels stay at a fixed CSS font size and
 *  remain readable when the orbit shrinks to a phone width.
 *
 *  Each label sits along the radial axis at radius=190 from the
 *  centre (just outside the node circle at radius=142+24=166),
 *  with translate-x/-y centring it on that point. The node
 *  labels never collide with the orbit ring because the radial
 *  push is enough to clear the node + a small margin.
 * ───────────────────────────────────────────────────────────────── */

function OrbitLabels({
  phoneApproved,
  laptopApproved,
  passkeyPending,
}: {
  phoneApproved: boolean;
  laptopApproved: boolean;
  passkeyPending: boolean;
}) {
  const states: Record<OrbitNode["id"], "approved" | "pending" | "idle"> = {
    phone: phoneApproved ? "approved" : "idle",
    laptop: laptopApproved ? "approved" : "idle",
    passkey: passkeyPending ? "pending" : "idle",
    ledger: "idle",
  };
  return (
    <div className="pointer-events-none absolute inset-0">
      {ORBIT_NODES.map((node) => {
        // Anchor the label to the node centre in % space (so it
        // tracks the orbit ring as the container scales) but push
        // it outward by a fixed CSS pixel amount (so the gap
        // between node and label stays constant regardless of
        // orbit size. Labels never end up clipped off the side).
        const r = (node.angleDeg * Math.PI) / 180;
        const nodeLeftPct =
          50 + (Math.cos(r) * ORBIT_RADIUS) / (ORBIT_VIEW / 2) * 50;
        const nodeTopPct =
          50 + (Math.sin(r) * ORBIT_RADIUS) / (ORBIT_VIEW / 2) * 50;
        const isAbove = node.angleDeg < 0;
        const verticalOffsetPx = isAbove ? -44 : 44;
        const state = states[node.id];
        return (
          <div
            key={node.id}
            className="absolute flex flex-col items-center text-center"
            style={{
              left: `${nodeLeftPct}%`,
              top: `${nodeTopPct}%`,
              transform: `translate(-50%, calc(-50% + ${verticalOffsetPx}px))`,
            }}
          >
            <span
              className={clsx(
                "whitespace-nowrap text-[11px] font-medium leading-tight transition-colors duration-300 sm:text-[12px]",
                state === "approved"
                  ? "text-white"
                  : state === "pending"
                    ? "text-white/85"
                    : "text-white/70",
              )}
            >
              {node.label}
            </span>
            <span
              className={clsx(
                "mt-0.5 whitespace-nowrap font-mono-tech text-[8px] uppercase tracking-[0.2em] transition-colors duration-300 sm:text-[9px]",
                state === "approved" ? "text-[#ccff00]" : "text-white/40",
              )}
            >
              {node.sub}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Phase status pill. Copy + tone updates per phase. ──────── */

function PhaseStatusPill({ phase, reduce }: { phase: Phase; reduce: boolean | null }) {
  const map: Record<Phase, { label: string; tone: "neutral" | "lime" | "lime-bright" }> = {
    0: { label: "Sealed", tone: "neutral" },
    1: { label: "Quorum forming", tone: "lime" },
    2: { label: "Quorum forming", tone: "lime" },
    3: { label: "Threshold met", tone: "lime-bright" },
    4: { label: "Recovery ready", tone: "lime-bright" },
  };
  const effectivePhase = reduce ? (4 as Phase) : phase;
  const { label, tone } = map[effectivePhase];
  const classes =
    tone === "lime-bright"
      ? "border-[#ccff00]/50 bg-[#ccff00]/[0.12] text-[#ccff00]"
      : tone === "lime"
        ? "border-[#ccff00]/30 bg-[#ccff00]/[0.06] text-[#ccff00]"
        : "border-white/12 bg-white/[0.03] text-white/55";
  return (
    <motion.span
      key={label}
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-mono-tech text-[9px] uppercase tracking-[0.22em] transition-colors duration-300",
        classes,
      )}
    >
      {label}
    </motion.span>
  );
}

/* ── Threshold count "2 / 4 · sweep enabled". Number animates
 * up as devices approve, tag changes once threshold met. ──── */

function ThresholdCount({ approved }: { approved: number }) {
  const ready = approved >= 2;
  return (
    <span
      className={clsx(
        "font-mono-tech text-[10px] uppercase tracking-[0.22em] transition-colors duration-300",
        ready ? "text-[#ccff00]" : "text-white/45",
      )}
    >
      <motion.span
        key={approved}
        initial={{ opacity: 0, y: -2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="inline-block tabular-nums"
      >
        {approved}
      </motion.span>{" "}
      / 4 · {ready ? "sweep enabled" : "awaiting"}
    </span>
  );
}

/* ── Signature output strip. Typewriter-reveals a stylized hex
 * once threshold is met; collapses to a placeholder otherwise. */

const SIGNATURE_HEX_FULL = "0x9af3 24c1 b8e0 7d52 4a16 fcd9 8b07 e1aa";
const SIGNATURE_HEX_SHORT = "0x9af3 24c1 b8e0 7d52 …";

function SignatureStrip({
  thresholdMet,
  animate,
}: {
  thresholdMet: boolean;
  animate: boolean;
}) {
  const reveal = thresholdMet;

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-black/30 px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex-shrink-0 font-mono-tech text-[9px] uppercase tracking-[0.22em] text-white/40">
          Signature
        </span>
        <span className="min-w-0 flex-1 truncate text-right sm:text-left">
          {!reveal && (
            <span className="font-mono-tech text-[11px] tracking-wider text-white/25">
              ·· ·· ·· ·· ··
            </span>
          )}
          {reveal && animate && (
            <>
              <span className="inline sm:hidden">
                <Typewriter text={SIGNATURE_HEX_SHORT} />
              </span>
              <span className="hidden sm:inline">
                <Typewriter text={SIGNATURE_HEX_FULL} />
              </span>
            </>
          )}
          {reveal && !animate && (
            <span className="font-mono-tech text-[11px] tracking-wider text-[#ccff00]">
              <span className="inline sm:hidden">{SIGNATURE_HEX_SHORT}</span>
              <span className="hidden sm:inline">{SIGNATURE_HEX_FULL}</span>
            </span>
          )}
        </span>
      </div>
      {/* Lime sweep on reveal */}
      <AnimatePresence>
        {animate && reveal && (
          <motion.div
            key="sweep"
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: "180%", opacity: 0.55 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3"
            style={{
              background:
                "linear-gradient(100deg, rgba(204,255,0,0) 30%, rgba(204,255,0,0.18) 50%, rgba(204,255,0,0) 70%)",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Typewriter. Reveals a hex string one char per ~30ms with a
 * mid-reveal "scrambling" stage on the cursor character for the
 * decoded-just-now feel. ──────────────────────────────────── */

const SCRAMBLE_POOL = "0123456789abcdef";

function Typewriter({ text }: { text: string }) {
  const [output, setOutput] = useState("");
  useEffect(() => {
    let i = 0;
    let scrambleStep = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (cancelled) return;
      if (i >= text.length) {
        setOutput(text);
        return;
      }
      const head = text.slice(0, i);
      const cur = text[i];
      // For non-hex characters (spaces, 'x') skip scramble.
      if (!/[0-9a-f]/i.test(cur)) {
        setOutput(head + cur);
        i += 1;
        scrambleStep = 0;
        timer = setTimeout(step, 30);
        return;
      }
      // 2 scramble frames per char before settling.
      if (scrambleStep < 2) {
        const rnd = SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)];
        setOutput(head + rnd);
        scrambleStep += 1;
        timer = setTimeout(step, 30);
      } else {
        setOutput(head + cur);
        i += 1;
        scrambleStep = 0;
        timer = setTimeout(step, 30);
      }
    };
    step();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);

  return (
    <span className="font-mono-tech text-[11px] tracking-wider text-[#ccff00]">
      {output}
      <span className="ml-0.5 inline-block h-3 w-[1px] animate-pulse bg-[#ccff00]/80 align-middle" />
    </span>
  );
}

/* ── Cipher rain. A CSS-only background of drifting hex glyphs
 * inside the card. Purely decorative; pointer-events-none and
 * dim opacity keep it out of the way of the orbit. ────────── */

function CardCipherRain() {
  const columns = useMemo(() => {
    const arr: { left: string; delay: string; duration: string; chars: string[] }[] = [];
    for (let i = 0; i < 14; i += 1) {
      const left = `${(i / 14) * 100 + Math.random() * 4}%`;
      const delay = `${-Math.random() * 10}s`;
      const duration = `${12 + Math.random() * 8}s`;
      const chars: string[] = [];
      for (let j = 0; j < 12; j += 1) {
        chars.push(SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)]);
      }
      arr.push({ left, delay, duration, chars });
    }
    return arr;
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[2rem] opacity-[0.08]"
    >
      {columns.map((col, i) => (
        <div
          key={i}
          className="absolute top-0 flex flex-col gap-1 font-mono-tech text-[10px] leading-tight text-[#ccff00]"
          style={{
            left: col.left,
            animation: `cipher-fall ${col.duration} linear ${col.delay} infinite`,
          }}
        >
          {col.chars.map((c, j) => (
            <span key={j} style={{ opacity: 1 - j / col.chars.length }}>
              {c}
            </span>
          ))}
        </div>
      ))}
      <style jsx>{`
        @keyframes cipher-fall {
          0% {
            transform: translateY(-50%);
          }
          100% {
            transform: translateY(150%);
          }
        }
      `}</style>
    </div>
  );
}
