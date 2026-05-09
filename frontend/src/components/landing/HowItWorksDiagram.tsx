"use client";

// HowItWorksDiagram - the animated illustration that lives in the
// methodology section. Tells the whole product story in one frame:
//
//   3 friends → 1 shared wallet → 5 destination chains
//
// Inspiration: the ika.xyz "How bridgeless capital markets work"
// section, which uses a single SVG flow diagram with traveling
// pulses to show value moving through their dWallet primitive.
//
// Implementation notes:
//
// - One self-contained <svg>. Connection paths are defined in <defs>
//   with stable ids, then referenced both as <use href=...> for
//   rendering AND as <mpath href=...> targets for <animateMotion>
//   so the lime pulses ride exactly the rendered path.
// - Chain logos are embedded via <image href=...> pointing at the
//   real brand SVGs in /public/chain-logos/. Same source the bento
//   uses (CHAINS metadata).
// - Pulse rings on the wallet use SMIL <animate> for r + opacity -
//   cheaper than CSS keyframes and stays in sync with the SVG
//   coordinate system.
// - prefers-reduced-motion: declarative SMIL respects the OS-level
//   reduce setting on Safari/Firefox; on Chromium it keeps animating
//   but the visual change is small enough to be ignorable.

const VIEW_W = 500;
const VIEW_H = 650;

// Avatar positions (top row).
const A1 = { x: 110, y: 90, name: "Sarah", initial: "S", grad: ["#ff8a4c", "#ff5a8a"] };
const A2 = { x: 250, y: 70, name: "Mark", initial: "M", grad: ["#7c4dff", "#4dc3ff"] };
const A3 = { x: 390, y: 90, name: "Ada", initial: "A", grad: ["#10b981", "#34d399"] };
const AVATARS = [A1, A2, A3];

// Central wallet position.
const WALLET = { x: 250, y: 325 };

// Chain logo positions (bottom row). Five evenly spread across the
// usable width, with a slight arc so the outermost two sit a touch
// higher than the centre - reads more like a fan than a flat line.
const CHAIN_POSITIONS: { x: number; y: number; src: string; label: string }[] = [
  { x: 60, y: 575, src: "/chain-logos/solana.svg", label: "Solana" },
  { x: 155, y: 565, src: "/chain-logos/ethereum.svg", label: "Ethereum" },
  { x: 250, y: 562, src: "/chain-logos/bitcoin.svg", label: "Bitcoin" },
  { x: 345, y: 565, src: "/chain-logos/zcash.svg", label: "Zcash" },
  { x: 440, y: 575, src: "/chain-logos/usdc.svg", label: "USDC" },
];
const CHAIN_SIZE = 40;

// Curved path from a top avatar (ax, ay) into the wallet centre.
function avatarToWalletPath(ax: number, ay: number) {
  const cx = ax + (WALLET.x - ax) * 0.5;
  const cy = ay + 90;
  return `M ${ax} ${ay + 32} Q ${cx} ${cy}, ${WALLET.x} ${WALLET.y - 50}`;
}

// Curved path from the wallet centre out to a chain logo's centre.
function walletToChainPath(cx: number, cy: number) {
  const chainCx = cx + CHAIN_SIZE / 2;
  const chainCy = cy + CHAIN_SIZE / 2;
  const midX = WALLET.x + (chainCx - WALLET.x) * 0.5;
  const midY = WALLET.y + 70;
  return `M ${WALLET.x} ${WALLET.y + 50} Q ${midX} ${midY}, ${chainCx} ${chainCy - CHAIN_SIZE / 2 - 4}`;
}

export function HowItWorksDiagram() {
  return (
    <div className="how-it-works-diagram relative mx-auto w-full max-w-[460px]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="How Clearsig works: three friends share one wallet that sends to Solana, Ethereum, Bitcoin, Zcash, and USDC."
      >
        <defs>
          {/* Path defs - referenced by both <use> for the visible
              line AND by <mpath> for traveling pulses. */}
          {AVATARS.map((a, i) => (
            <path
              key={`p-in-${i}`}
              id={`hi-path-in-${i}`}
              d={avatarToWalletPath(a.x, a.y)}
            />
          ))}
          {CHAIN_POSITIONS.map((c, i) => (
            <path
              key={`p-out-${i}`}
              id={`hi-path-out-${i}`}
              d={walletToChainPath(c.x, c.y)}
            />
          ))}

          {/* Avatar gradients - each gets its own <linearGradient>. */}
          {AVATARS.map((a, i) => (
            <linearGradient
              key={`grad-${i}`}
              id={`hi-avatar-grad-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={a.grad[0]} />
              <stop offset="100%" stopColor={a.grad[1]} />
            </linearGradient>
          ))}

          {/* Wallet bloom - softened so the lime feels confident,
              not shouty. Lower opacity stops + tighter falloff. */}
          <radialGradient id="hi-wallet-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ccff00" stopOpacity="0.18" />
            <stop offset="60%" stopColor="#ccff00" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#ccff00" stopOpacity="0" />
          </radialGradient>

          {/* Lime glow filter for traveling pulses. */}
          <filter id="hi-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Soft drop shadow for the chain logo tiles. */}
          <filter id="hi-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="6"
              stdDeviation="6"
              floodColor="#000"
              floodOpacity="0.5"
            />
          </filter>
        </defs>

        {/* ── Connection lines ───────────────────────────────────── */}
        {/* Top three: avatars → wallet (white at low opacity). */}
        {AVATARS.map((_, i) => (
          <use
            key={`u-in-${i}`}
            href={`#hi-path-in-${i}`}
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1.5"
            strokeDasharray="3 5"
            fill="none"
          />
        ))}
        {/* Bottom five: wallet → chains (lime tinted). */}
        {CHAIN_POSITIONS.map((_, i) => (
          <use
            key={`u-out-${i}`}
            href={`#hi-path-out-${i}`}
            stroke="rgba(204,255,0,0.22)"
            strokeWidth="1.5"
            strokeDasharray="3 5"
            fill="none"
          />
        ))}

        {/* ── Central wallet ─────────────────────────────────────── */}
        <g>
          {/* Outer bloom */}
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="100"
            fill="url(#hi-wallet-glow)"
          />
          {/* Pulse ring 1 */}
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="50"
            fill="none"
            stroke="rgba(204,255,0,0.32)"
            strokeWidth="1.4"
          >
            <animate
              attributeName="r"
              from="50"
              to="100"
              dur="3.2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.7"
              to="0"
              dur="3.2s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Pulse ring 2 - offset for layered effect */}
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="50"
            fill="none"
            stroke="rgba(204,255,0,0.32)"
            strokeWidth="1.4"
          >
            <animate
              attributeName="r"
              from="50"
              to="100"
              dur="3.2s"
              begin="1.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.7"
              to="0"
              dur="3.2s"
              begin="1.6s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Wallet body - lime tile with the brand C */}
          <circle
            cx={WALLET.x}
            cy={WALLET.y}
            r="48"
            fill="rgba(204,255,0,0.10)"
            stroke="rgba(204,255,0,0.32)"
            strokeWidth="1.5"
          />
          <rect
            x={WALLET.x - 24}
            y={WALLET.y - 24}
            width="48"
            height="48"
            rx="12"
            fill="#ccff00"
          />
          {/* Clearsig brand mark - two interlocking circles. SVG
              source paths from BrandMark.tsx, inlined here so they
              draw natively inside the diagram's coordinate space.
              Original viewBox is 24x24; the wallet tile is 48x48 so
              scale 36/24 = 1.5 for a ~36px mark inside the tile. */}
          <g
            transform={`translate(${WALLET.x - 18}, ${WALLET.y - 18}) scale(1.5)`}
          >
            <circle
              cx="9"
              cy="12"
              r="5.25"
              stroke="#0c0c0c"
              strokeWidth="2.4"
              fill="none"
            />
            <circle
              cx="15"
              cy="12"
              r="5.25"
              stroke="#0c0c0c"
              strokeWidth="2.4"
              fill="none"
            />
            <path
              d="M 12 7.04 A 5.25 5.25 0 0 1 12 16.96 A 5.25 5.25 0 0 1 12 7.04 Z"
              fill="#0c0c0c"
              opacity="0.4"
            />
          </g>
        </g>

        {/* ── Avatars (top row) ──────────────────────────────────── */}
        {AVATARS.map((a, i) => (
          <g key={`avatar-${i}`}>
            <circle
              cx={a.x}
              cy={a.y}
              r="28"
              fill={`url(#hi-avatar-grad-${i})`}
            />
            <text
              x={a.x}
              y={a.y + 6}
              textAnchor="middle"
              fontSize="15"
              fontWeight="600"
              fill="white"
              fontFamily="ui-sans-serif, system-ui"
            >
              {a.initial}
            </text>
            {/* Approved tick badge */}
            <g transform={`translate(${a.x + 18}, ${a.y + 18})`}>
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
          </g>
        ))}

        {/* ── Chain logos (bottom row) ───────────────────────────── */}
        {CHAIN_POSITIONS.map((c, i) => (
          <g key={`chain-${i}`} filter="url(#hi-shadow)">
            {/* Tile background so the logo has a clear surface */}
            <rect
              x={c.x - 4}
              y={c.y - 4}
              width={CHAIN_SIZE + 8}
              height={CHAIN_SIZE + 8}
              rx="12"
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
        ))}

        {/* ── Traveling pulses ───────────────────────────────────── */}
        {/* Top three: avatars → wallet. Staggered so the eye reads
            "all three approve, all three flow in." */}
        {AVATARS.map((_, i) => (
          <circle
            key={`pulse-in-${i}`}
            r="4"
            fill="#ccff00"
            filter="url(#hi-glow)"
          >
            <animateMotion
              dur="3s"
              repeatCount="indefinite"
              begin={`${i * 0.5}s`}
              rotate="auto"
            >
              <mpath href={`#hi-path-in-${i}`} />
            </animateMotion>
          </circle>
        ))}
        {/* Bottom five: wallet → chains. Slight extra delay so they
            visually follow the inbound pulses. */}
        {CHAIN_POSITIONS.map((_, i) => (
          <circle
            key={`pulse-out-${i}`}
            r="4"
            fill="#ccff00"
            filter="url(#hi-glow)"
          >
            <animateMotion
              dur="3.4s"
              repeatCount="indefinite"
              begin={`${1.6 + i * 0.4}s`}
              rotate="auto"
            >
              <mpath href={`#hi-path-out-${i}`} />
            </animateMotion>
          </circle>
        ))}
      </svg>

      {/* Floating step labels - sit on top of the SVG so the
          diagram reads as a story even without scrolling to the
          left-side numbered list. Mobile-friendly text sizes. */}
      <div className="pointer-events-none absolute left-0 right-0 top-[3%] flex justify-center">
        <div className="rounded-full border border-white/10 bg-[#0c0c0c]/85 px-3 py-1.5 backdrop-blur-md">
          <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/70">
            01 · friends
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute left-0 right-0 top-[44%] flex justify-end pr-2 sm:pr-6">
        <div className="rounded-full border border-[#ccff00]/30 bg-[#ccff00]/[0.08] px-3 py-1.5 backdrop-blur-md">
          <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-[#ccff00]">
            02 · one wallet
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-[2%] left-0 right-0 flex justify-center">
        <div className="rounded-full border border-white/10 bg-[#0c0c0c]/85 px-3 py-1.5 backdrop-blur-md">
          <span className="font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/70">
            03 · every chain
          </span>
        </div>
      </div>
    </div>
  );
}
