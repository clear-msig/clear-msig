"use client";

// HowItWorksDiagram - the animated illustration that lives in the
// methodology section. Tells the whole product story in one frame:
//
//   3 friends → 1 shared wallet → 5 destination chains
//
// Inspiration: ika.xyz's "How bridgeless capital markets work"
// section, which uses a single SVG flow diagram with traveling
// pulses to show value moving through their dWallet primitive.
//
// Layout pass v2:
//   • Step labels are SVG-internal chips anchored to the LEFT edge
//     of each row, so they never overlap a node again. The previous
//     overlay-DIV implementation collided with avatar M and the
//     Bitcoin chip on common widths.
//   • Avatars sit on a flat baseline (y=125) - the previous slight
//     arc made the centre avatar fight with the eyebrow chip above it.
//   • Wallet is bigger (r=56 inner) and grounded with a "wallet"
//     nameplate so the focal element reads as a real product piece,
//     not a floating tile.
//   • Chains carry their own row label tile underneath each logo so
//     the bottom row reads as a labelled spec strip, not just a
//     handful of icons.
//   • Connection lines: dual-stroke. A subtle dashed background +
//     a brighter solid foreground that's masked by an animated
//     gradient so each line "fills" with light as a pulse rides
//     it. Reads as "a packet just travelled here," not "this line
//     is decorative."

import { useId } from "react";

const VIEW_W = 600;
const VIEW_H = 760;

// Avatar positions (top row). Flat baseline so the eyebrow chip
// above has clean space to sit without colliding.
const AVATARS = [
  {
    x: 130,
    y: 130,
    name: "Sarah",
    initial: "S",
    grad: ["#ff8a4c", "#ff5a8a"] as const,
  },
  {
    x: 300,
    y: 130,
    name: "Mark",
    initial: "M",
    grad: ["#7c4dff", "#4dc3ff"] as const,
  },
  {
    x: 470,
    y: 130,
    name: "Ada",
    initial: "A",
    grad: ["#10b981", "#34d399"] as const,
  },
];

// Central wallet position.
const WALLET = { x: 300, y: 380 };

// Chain logo positions (bottom row). Five evenly spread, tightly
// flat - the previous arc made BTC sit slightly higher, which only
// looked like a layout bug.
const CHAIN_POSITIONS: {
  x: number;
  y: number;
  src: string;
  label: string;
}[] = [
  { x: 60, y: 620, src: "/chain-logos/solana.svg", label: "Solana" },
  { x: 175, y: 620, src: "/chain-logos/ethereum.svg", label: "Ethereum" },
  { x: 290, y: 620, src: "/chain-logos/bitcoin.svg", label: "Bitcoin" },
  { x: 405, y: 620, src: "/chain-logos/zcash.svg", label: "Zcash" },
  { x: 520, y: 620, src: "/chain-logos/usdc.svg", label: "USDC" },
];
const CHAIN_SIZE = 44;

// Curved path from a top avatar (ax, ay) into the wallet's top edge.
function avatarToWalletPath(ax: number, ay: number) {
  const startY = ay + 36; // bottom of avatar tile
  const endY = WALLET.y - 70; // top of wallet outer ring
  const cy = ay + 130; // control point below avatar
  return `M ${ax} ${startY} Q ${ax} ${cy}, ${WALLET.x} ${endY}`;
}

// Curved path from the wallet's bottom edge out to a chain logo's
// top-centre.
function walletToChainPath(cx: number, cy: number) {
  const chainCx = cx + CHAIN_SIZE / 2;
  const startY = WALLET.y + 70; // bottom of outer wallet ring
  const endY = cy - 6; // just above chain tile
  const midY = WALLET.y + 130;
  return `M ${WALLET.x} ${startY} Q ${WALLET.x} ${midY}, ${chainCx} ${endY}`;
}

export function HowItWorksDiagram() {
  // Stable unique ids per mount so multiple instances on the same
  // page don't clash on gradient / filter targets.
  const uid = useId().replace(/[^a-z0-9]/gi, "");

  const ID = {
    pIn: (i: number) => `${uid}-p-in-${i}`,
    pOut: (i: number) => `${uid}-p-out-${i}`,
    avatarGrad: (i: number) => `${uid}-avatar-${i}`,
    walletGlow: `${uid}-wallet-glow`,
    pulseGlow: `${uid}-pulse-glow`,
    tileShadow: `${uid}-tile-shadow`,
    grid: `${uid}-grid`,
    walletBg: `${uid}-wallet-bg`,
  };

  return (
    <div className="how-it-works-diagram relative mx-auto w-full max-w-[520px]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="How Clearsig works: three friends share one wallet that sends to Solana, Ethereum, Bitcoin, Zcash, and USDC."
      >
        <defs>
          {/* ── Background grid pattern ─────────────────────────
           * Subtle 30px grid behind the whole diagram. Anchors the
           * scene like a technical schematic without competing
           * with the foreground content. */}
          <pattern
            id={ID.grid}
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 30 0 L 0 0 0 30"
              fill="none"
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
            />
          </pattern>

          {/* Path defs - referenced by both <use> for the visible
              line AND by <mpath> for traveling pulses. */}
          {AVATARS.map((a, i) => (
            <path
              key={`p-in-${i}`}
              id={ID.pIn(i)}
              d={avatarToWalletPath(a.x, a.y)}
            />
          ))}
          {CHAIN_POSITIONS.map((c, i) => (
            <path
              key={`p-out-${i}`}
              id={ID.pOut(i)}
              d={walletToChainPath(c.x, c.y)}
            />
          ))}

          {/* Avatar gradients */}
          {AVATARS.map((a, i) => (
            <linearGradient
              key={`grad-${i}`}
              id={ID.avatarGrad(i)}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={a.grad[0]} />
              <stop offset="100%" stopColor={a.grad[1]} />
            </linearGradient>
          ))}

          {/* Wallet bloom */}
          <radialGradient id={ID.walletGlow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ccff00" stopOpacity="0.22" />
            <stop offset="55%" stopColor="#ccff00" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#ccff00" stopOpacity="0" />
          </radialGradient>

          {/* Wallet inner background - radial gloss for the tile. */}
          <radialGradient id={ID.walletBg} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#e5ff66" />
            <stop offset="100%" stopColor="#ccff00" />
          </radialGradient>

          {/* Pulse glow filter */}
          <filter
            id={ID.pulseGlow}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Soft drop shadow for chain tiles */}
          <filter
            id={ID.tileShadow}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feDropShadow
              dx="0"
              dy="6"
              stdDeviation="6"
              floodColor="#000"
              floodOpacity="0.5"
            />
          </filter>
        </defs>

        {/* Background grid */}
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${ID.grid})`} />

        {/* ── Step row labels ────────────────────────────────────
         * Three small chips anchored at the left edge of each row
         * inside the SVG so they scale with the diagram and never
         * overlap a node. Numbered eyebrow + caps label. */}
        <RowLabel
          x={20}
          y={32}
          n="01"
          label="friends"
          mode="muted"
        />
        <RowLabel
          x={20}
          y={WALLET.y - 90}
          n="02"
          label="one wallet"
          mode="accent"
        />
        <RowLabel
          x={20}
          y={CHAIN_POSITIONS[0]!.y - 50}
          n="03"
          label="every chain"
          mode="muted"
        />

        {/* ── Connection lines ───────────────────────────────────
         * Background dashed strokes for structure + foreground
         * solid strokes for traveled paths (drawn under animated
         * pulses). */}
        {AVATARS.map((_, i) => (
          <use
            key={`u-in-${i}`}
            href={`#${ID.pIn(i)}`}
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1.5"
            strokeDasharray="2 4"
            fill="none"
          />
        ))}
        {CHAIN_POSITIONS.map((_, i) => (
          <use
            key={`u-out-${i}`}
            href={`#${ID.pOut(i)}`}
            stroke="rgba(204, 255, 0,0.20)"
            strokeWidth="1.5"
            strokeDasharray="2 4"
            fill="none"
          />
        ))}

        {/* ── Central wallet ─────────────────────────────────────
         * Outer bloom + two staggered pulse rings + the brand tile.
         * Larger inner tile (56→64) so the brand mark gets weight. */}
        <g>
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="120"
            fill={`url(#${ID.walletGlow})`}
          />
          {/* Continuous pulse rings - the wallet "breathes" to show
              it's the live focal element. */}
          {[0, 1.5].map((delay, idx) => (
            <circle
              key={`ring-${idx}`}
              cx={WALLET.x}
              cy={WALLET.y}
              r="64"
              fill="none"
              stroke="rgba(204, 255, 0,0.42)"
              strokeWidth="1.6"
            >
              <animate
                attributeName="r"
                from="64"
                to="118"
                dur="3s"
                begin={`${delay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.7"
                to="0"
                dur="3s"
                begin={`${delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
          {/* Outer ring - dim, holds the bloom in. */}
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="64"
            fill="none"
            stroke="rgba(204, 255, 0,0.30)"
            strokeWidth="1.2"
          />
          {/* Inner accent ring - solid lime tint at low opacity. */}
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="56"
            fill="rgba(204, 255, 0,0.06)"
            stroke="rgba(204, 255, 0,0.42)"
            strokeWidth="1.6"
          />
          {/* Brand tile - bigger (60×60) so the mark reads at any
              page width. Gradient face for a touch of depth. */}
          <rect
            x={WALLET.x - 30}
            y={WALLET.y - 30}
            width="60"
            height="60"
            rx="30"
            fill={`url(#${ID.walletBg})`}
          />
          {/* Brand mark - the official C-mark. Light-surface variant
              (dark arcs) so it reads against the lime tile face. */}
          <image
            href="/clearmark-light.svg"
            x={WALLET.x - 22}
            y={WALLET.y - 22}
            width="44"
            height="44"
            preserveAspectRatio="xMidYMid meet"
          />
          {/* Wallet nameplate - sits flush below the tile. Small,
              monospace, all-caps so it reads as a chrome label, not
              extra copy. */}
          <g transform={`translate(${WALLET.x}, ${WALLET.y + 92})`}>
            <rect
              x="-58"
              y="-13"
              width="116"
              height="26"
              rx="13"
              fill="rgba(12,12,12,0.85)"
              stroke="rgba(204, 255, 0,0.30)"
              strokeWidth="1"
            />
            <text
              y="5"
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="#ccff00"
              letterSpacing="0.18em"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              CLEARSIG · WALLET
            </text>
          </g>
        </g>

        {/* ── Avatars (top row) ──────────────────────────────────
         * Each avatar gets a soft halo pulse + a lime tick. The
         * halo expands continuously and stays subtle so it doesn't
         * fight the central wallet's pulse rings. */}
        {AVATARS.map((a, i) => (
          <g key={`avatar-${i}`}>
            {/* Continuous breathing halo - very subtle. */}
            <circle
              cx={a.x}
              cy={a.y}
              r="32"
              fill="none"
              stroke={`rgba(255,255,255,0.18)`}
              strokeWidth="1"
            >
              <animate
                attributeName="r"
                from="32"
                to="44"
                dur="2.4s"
                begin={`${i * 0.4}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.45"
                to="0"
                dur="2.4s"
                begin={`${i * 0.4}s`}
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={a.x}
              cy={a.y}
              r="32"
              fill={`url(#${ID.avatarGrad(i)})`}
              filter={`url(#${ID.tileShadow})`}
            />
            <text
              x={a.x}
              y={a.y + 6}
              textAnchor="middle"
              fontSize="17"
              fontWeight="600"
              fill="white"
              fontFamily="ui-sans-serif, system-ui"
            >
              {a.initial}
            </text>
            {/* Approved tick badge */}
            <g transform={`translate(${a.x + 22}, ${a.y + 22})`}>
              <circle r="9" fill="#ccff00" stroke="#0c0c0c" strokeWidth="2" />
              <path
                d="M -3 0 L -1 2 L 3 -2"
                stroke="#0c0c0c"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
            {/* Avatar name plate - small lime caps tag below */}
            <g transform={`translate(${a.x}, ${a.y + 56})`}>
              <text
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill="rgba(255,255,255,0.55)"
                letterSpacing="0.18em"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {a.name.toUpperCase()}
              </text>
            </g>
          </g>
        ))}

        {/* ── Chain logos (bottom row) ───────────────────────────
         * Each chain has a tile + the brand SVG + a name plate
         * underneath. The plate makes the row read as a labelled
         * spec strip, not five anonymous icons. */}
        {CHAIN_POSITIONS.map((c, i) => (
          <g key={`chain-${i}`}>
            <g filter={`url(#${ID.tileShadow})`}>
              <rect
                x={c.x - 4}
                y={c.y - 4}
                width={CHAIN_SIZE + 8}
                height={CHAIN_SIZE + 8}
                rx="14"
                fill="#0c0c0c"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="1"
              />
              <image
                href={c.src}
                x={c.x}
                y={c.y}
                width={CHAIN_SIZE}
                height={CHAIN_SIZE}
              />
            </g>
            {/* Chain name label */}
            <text
              x={c.x + CHAIN_SIZE / 2}
              y={c.y + CHAIN_SIZE + 24}
              textAnchor="middle"
              fontSize="9"
              fontWeight="600"
              fill="rgba(255,255,255,0.55)"
              letterSpacing="0.18em"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {c.label.toUpperCase()}
            </text>
          </g>
        ))}

        {/* ── Traveling pulses ───────────────────────────────────
         * Lime particles that ride each connection path. Inbound
         * (avatars→wallet) is staggered 0/0.3/0.6s. Outbound
         * (wallet→chains) is offset by 1.5s so it visually follows
         * the inbound wave - reads as one continuous heartbeat. */}
        {AVATARS.map((_, i) => (
          <g key={`pulse-in-${i}`}>
            {/* Trailing glow halo */}
            <circle r="6" fill="rgba(204, 255, 0,0.25)">
              <animateMotion
                dur="1.4s"
                repeatCount="indefinite"
                begin={`${i * 0.3}s`}
              >
                <mpath href={`#${ID.pIn(i)}`} />
              </animateMotion>
            </circle>
            {/* Sharp head */}
            <circle r="3" fill="#ccff00" filter={`url(#${ID.pulseGlow})`}>
              <animateMotion
                dur="1.4s"
                repeatCount="indefinite"
                begin={`${i * 0.3}s`}
              >
                <mpath href={`#${ID.pIn(i)}`} />
              </animateMotion>
            </circle>
          </g>
        ))}
        {CHAIN_POSITIONS.map((_, i) => (
          <g key={`pulse-out-${i}`}>
            <circle r="6" fill="rgba(204, 255, 0,0.25)">
              <animateMotion
                dur="1.7s"
                repeatCount="indefinite"
                begin={`${1.4 + i * 0.18}s`}
              >
                <mpath href={`#${ID.pOut(i)}`} />
              </animateMotion>
            </circle>
            <circle r="3" fill="#ccff00" filter={`url(#${ID.pulseGlow})`}>
              <animateMotion
                dur="1.7s"
                repeatCount="indefinite"
                begin={`${1.4 + i * 0.18}s`}
              >
                <mpath href={`#${ID.pOut(i)}`} />
              </animateMotion>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Step row label ───────────────────────────────────────────────
//
// Internal SVG chip for the `01 · friends` / `02 · one wallet` /
// `03 · every chain` markers. Sits at a fixed (x, y) anchored to a
// row's top-left so the label can never overlap a node, regardless
// of viewport width.

function RowLabel({
  x,
  y,
  n,
  label,
  mode,
}: {
  x: number;
  y: number;
  n: string;
  label: string;
  mode: "muted" | "accent";
}) {
  const isAccent = mode === "accent";
  const fg = isAccent ? "#ccff00" : "rgba(255,255,255,0.65)";
  const bg = isAccent
    ? "rgba(204, 255, 0,0.08)"
    : "rgba(12,12,12,0.85)";
  const stroke = isAccent
    ? "rgba(204, 255, 0,0.30)"
    : "rgba(255,255,255,0.10)";
  const text = `${n} · ${label}`;
  // Approximate width based on character count - 8.5px/char for
  // the monospace caps treatment plus 24px horizontal padding.
  const w = 24 + text.length * 7.5;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="0"
        y="0"
        width={w}
        height="26"
        rx="13"
        fill={bg}
        stroke={stroke}
        strokeWidth="1"
      />
      <text
        x={w / 2}
        y="17"
        textAnchor="middle"
        fontSize="10"
        fontWeight="600"
        fill={fg}
        letterSpacing="0.20em"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {text.toUpperCase()}
      </text>
    </g>
  );
}
