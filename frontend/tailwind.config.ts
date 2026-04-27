import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ── Design tokens ────────────────────────────────────────────────
      // Keep the existing palette (brand-green #72b90d is used throughout
      // the app and by the wallet-adapter override in globals.css). New
      // tokens are additive.
      colors: {
        background: "#f4f4f5",
        surface: "#000000",
        "surface-soft": "#18181b",
        "brand-green": "#72b90d",
        "brand-green-bright": "#a3e635",
        "brand-emerald": "#10b981",
        "brand-white": "#ffffff",
        "text-primary": "#18181b",
        "text-strong": "#0f172a",
        "text-muted": "#71717a",
        "text-card": "#ffffff",
        "text-card-muted": "#a1a1aa",
      },
      fontFamily: {
        // Composed at runtime via CSS variables defined in layout.tsx.
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-inter)", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // Harmonised scale — the hero can step up beyond text-6xl.
        "hero-sm": ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        "hero-md": ["3.75rem", { lineHeight: "1.02", letterSpacing: "-0.025em" }],
        "hero-lg": ["5rem", { lineHeight: "0.98", letterSpacing: "-0.03em" }],
        "hero-xl": ["6.25rem", { lineHeight: "0.96", letterSpacing: "-0.035em" }],
      },
      letterSpacing: {
        "ultra-tight": "-0.04em",
      },
      boxShadow: {
        glow: "0 10px 30px -10px rgba(114, 185, 13, 0.5)",
        "glow-hover": "0 20px 40px -10px rgba(114, 185, 13, 0.7)",
        "glow-strong": "0 0 60px -10px rgba(114, 185, 13, 0.6)",
        "card-shadow": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        "card-dark": "0 20px 45px -15px rgba(0, 0, 0, 0.65)",
        "inner-glow": "inset 0 0 0 1px rgba(114, 185, 13, 0.2)",
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
          "radial-gradient(circle at 50% 0%, rgba(114,185,13,0.08), transparent 60%)",
        "hero-noise":
          "linear-gradient(135deg, rgba(114,185,13,0.06) 0%, rgba(0,0,0,0.04) 100%)",
        "skeleton-shimmer":
          "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%)",
      },
      screens: {
        // `xs` is useful for 360px-wide phones — keeps the layouts tight
        // without stacking everything.
        xs: "420px",
      },
    },
  },
  plugins: [],
};

export default config;
