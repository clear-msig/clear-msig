import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────────────────
// Design tokens · retail rebuild (locked 2026-04-30)
//
// Two layers live here side-by-side during the 4-6 week rebuild:
//
//   1. SEMANTIC tokens (the new system) — `bg-app`, `surface-card`,
//      `accent`, `text-strong`, `display-md`, `tap`, `duration-base`,
//      `ease-out-soft`. These are what new retail components consume.
//
//   2. LEGACY aliases (`brand-green`, `text-primary`, `hero-xl`, etc.)
//      kept at their original values so the existing `/app/*` surface
//      and landing page keep rendering. Delete this block once every
//      consumer has migrated to the semantic names.
// ─────────────────────────────────────────────────────────────────────

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Semantic ──────────────────────────────────────────────
        canvas: "#f4f4f5",
        // Dark surfaces sit in the mid-gray family — never pure black.
        // Lifted further on 2026-04-30 to match the rendered gray of the
        // workflow-tips translucent layers (the user's reference). All
        // values keep WCAG AA contrast with white text.
        // See `feedback_dark_surfaces.md` for the full rationale.
        "surface-card": "#3f3f46",
        "surface-card-strong": "#27272a",
        "surface-soft": "#52525b",
        "surface-raised": "#ffffff",

        // Teal experiment 2026-05-03: shifting off finance-default
        // green (#16a34a is identical to Cash App / Robinhood /
        // Splitwise / Mint). teal-700 is mature, confident, less
        // commodity. Hover/bright are scaled inside the same family
        // so shadow-accent-* and bg-accent/15 transitions still feel
        // coherent. Revert by changing these four values back if we
        // decide the green was right after all.
        accent: "#0f766e",
        "accent-hover": "#115e59",
        "accent-bright": "#14b8a6",
        "accent-emerald": "#0d9488",

        "text-strong": "#0f172a",
        "text-primary": "#18181b",
        "text-soft": "#71717a",
        "text-on-dark": "#ffffff",
        "text-on-dark-soft": "#a1a1aa",

        "border-soft": "#e4e4e7",
        "border-strong": "#d4d4d8",

        success: "#16a34a",
        danger: "#dc2626",
        warning: "#f59e0b",
        info: "#0ea5e9",

        // ── Legacy aliases (retire during overlap) ───────────────
        background: "#f4f4f5",
        surface: "#27272a",
        "brand-green": "#16a34a",
        "brand-green-bright": "#22c55e",
        "brand-emerald": "#10b981",
        "brand-white": "#ffffff",
        "text-muted": "#71717a",
        "text-card": "#ffffff",
        "text-card-muted": "#a1a1aa",
      },

      fontFamily: {
        // One sans family, everywhere. `font-display` survives as a
        // class so existing callers don't need to be touched, but it
        // resolves to the same Geist family — weight + size do the
        // hierarchy lifting now.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },

      fontSize: {
        // Display scale — sans-tightened, capped at 2.5rem on desktop.
        // Old scale (Fraunces) climbed to 5rem, which read as magazine
        // hero, not money app. Geist at 2.5rem with weight 700 is the
        // Cash App / Apple Wallet register.
        "display-xs": ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.015em" }],
        "display-sm": ["2rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-md": ["2.25rem", { lineHeight: "1.08", letterSpacing: "-0.022em" }],
        "display-lg": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-xl": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],

        // Legacy hero-* — same cap. Retire over time.
        "hero-sm": ["2rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "hero-md": ["2.25rem", { lineHeight: "1.08", letterSpacing: "-0.022em" }],
        "hero-lg": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "hero-xl": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
      },

      letterSpacing: {
        "ultra-tight": "-0.04em",
      },

      spacing: {
        // Touch sizing — Apple HIG min target is 44px; 56px for primary CTAs.
        tap: "44px",
        "tap-lg": "56px",
        // Page gutters — generous on mobile, more on desktop.
        gutter: "20px",
        "gutter-lg": "28px",
        // iOS bottom-bar safe inset (use as `pb-safe-bottom` on bottom-nav).
        "safe-bottom": "env(safe-area-inset-bottom, 0px)",
        "safe-top": "env(safe-area-inset-top, 0px)",
      },

      minHeight: {
        tap: "44px",
        "tap-lg": "56px",
      },

      minWidth: {
        tap: "44px",
      },

      borderRadius: {
        // Friendly, banking-app feel — softer than the hard `rounded-md` default.
        soft: "10px",
        card: "16px",
        sheet: "24px",
      },

      transitionDuration: {
        fast: "150ms",
        base: "250ms",
        slow: "400ms",
      },

      transitionTimingFunction: {
        // `out-soft` → entrances, hover-lift; `in-out-soft` → state changes.
        "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)",
        "in-out-soft": "cubic-bezier(0.65, 0, 0.35, 1)",
      },

      boxShadow: {
        // ── Semantic ──────────────────────────────────────────────
        // Layered shadows + a 1px top highlight. The highlight reads
        // as a soft rim-light from above, the layered drops give
        // cards a touch of depth without crossing into skeuomorphism.
        // Cash App / Venmo as the reference; very subtle.
        "card-rest":
          "inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 18px rgba(15, 23, 42, 0.07), 0 2px 6px rgba(15, 23, 42, 0.04)",
        "card-raised":
          "inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 4px 14px rgba(15, 23, 42, 0.10), 0 16px 40px rgba(15, 23, 42, 0.12)",
        "accent-rest": "0 8px 24px -8px rgba(22, 163, 74, 0.30)",
        "accent-hover": "0 16px 36px -10px rgba(22, 163, 74, 0.40)",

        // ── Legacy ────────────────────────────────────────────────
        glow: "0 10px 30px -10px rgba(22, 163, 74, 0.30)",
        "glow-hover": "0 20px 40px -10px rgba(22, 163, 74, 0.40)",
        "glow-strong": "0 0 60px -10px rgba(22, 163, 74, 0.35)",
        "card-shadow": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        "card-dark": "0 20px 45px -15px rgba(0, 0, 0, 0.65)",
        "inner-glow": "inset 0 0 0 1px rgba(22, 163, 74, 0.15)",
      },

      animation: {
        "pulse-glow": "pulseGlow 8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 2.2s linear infinite",
        "scan-line": "scanLine 4s linear infinite",
        "auto-scroll": "autoScroll var(--scroll-duration, 30s) linear infinite",
      },

      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "0.1", transform: "scale(1)" },
          "50%": { opacity: "0.3", transform: "scale(1.1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        scanLine: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(500%)" },
        },
        autoScroll: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },

      backgroundImage: {
        "hero-grid":
          "radial-gradient(circle at 50% 0%, rgba(22,163,74,0.08), transparent 60%)",
        "hero-noise":
          "linear-gradient(135deg, rgba(22,163,74,0.06) 0%, rgba(0,0,0,0.04) 100%)",
        "skeleton-shimmer":
          "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%)",
      },

      screens: {
        // 360px-class phones — keeps tight layouts from stacking too early.
        xs: "420px",
      },
    },
  },
  plugins: [],
};

export default config;
