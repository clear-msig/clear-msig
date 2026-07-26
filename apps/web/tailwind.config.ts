import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────────────────
// Design tokens · retail rebuild (locked 2026-04-30)
//
// Two layers live here side-by-side during the 4-6 week rebuild:
//
//   1. SEMANTIC tokens (the new system) - `bg-app`, `surface-card`,
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
  // Class-based dark mode via the `data-theme="dark"` attribute on
  // <html>, set by lib/security/theme.ts. Five semantic tokens
  // (canvas / surface-raised / border-soft / text-strong /
  // text-soft) resolve to CSS vars, defined in globals.css per
  // theme - flips the load-bearing surfaces without touching every
  // call-site's `bg-canvas` / `text-text-strong` class.
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── Semantic ──────────────────────────────────────────────
        // The 5 highest-traffic tokens are CSS vars so dark mode
        // can flip them without per-class diffs. Everything else
        // stays a fixed value - accent green / feedback / etc.
        // should look the same in both themes.
        canvas: "var(--clear-canvas, #f4f4f5)",
        "surface-raised": "var(--clear-surface-raised, #ffffff)",
        "surface-elevated": "var(--clear-surface-elevated, #ffffff)",
        "surface-sunken": "var(--clear-surface-sunken, #eef0f4)",
        "text-strong": "var(--clear-text-strong, #0f172a)",
        "text-soft": "var(--clear-text-soft, #71717a)",
        "text-softer": "var(--clear-text-softer, rgba(10, 14, 22, 0.42))",
        "border-soft": "var(--clear-border-soft, #e4e4e7)",
        "border-strong": "var(--clear-border-strong, #d4d4d8)",
        // Theme-aware glass overlays - replace ad-hoc bg-white/[0.0X]
        // surfaces. Dark = white-on-dark tint; light = black-on-light.
        "glass-soft": "var(--clear-glass-soft, rgba(10, 14, 22, 0.03))",
        "glass-mid": "var(--clear-glass-mid, rgba(10, 14, 22, 0.05))",
        "glass-strong": "var(--clear-glass-strong, rgba(10, 14, 22, 0.08))",

        // Dark surfaces sit in the mid-gray family - never pure black.
        // Lifted further on 2026-04-30 to match the rendered gray of the
        // workflow-tips translucent layers (the user's reference). All
        // values keep WCAG AA contrast with white text.
        // See `feedback_dark_surfaces.md` for the full rationale.
        "surface-card": "#3f3f46",
        "surface-card-strong": "#27272a",
        "surface-soft": "#52525b",

        // Brand pivot 2026-05-08: accent is now lime (Obsidian & Lime
        // identity) in dark mode. Light mode swaps in a deeper
        // emerald-green via the --clear-accent CSS variable so the
        // brand colour actually reads on white surfaces - lime on
        // white is invisible. Defaults are the dark-mode values so
        // standalone class previews (Storybook, etc) still render
        // correctly without a theme attribute. text-on-accent flips
        // black↔white in lockstep so button contrast stays correct.
        accent: "var(--clear-accent, #ccff00)",
        "accent-hover": "var(--clear-accent-hover, #d8ff33)",
        "accent-bright": "var(--clear-accent-bright, #e0ff66)",
        "accent-emerald": "#10b981",
        "text-on-accent": "var(--clear-text-on-accent, #000000)",

        "text-primary": "#18181b",
        "text-on-dark": "#ffffff",
        "text-on-dark-soft": "#a1a1aa",

        // border-strong is now defined above as a CSS-var token; the
        // legacy hard-coded #d4d4d8 fell out of date when the obsidian
        // dark theme shipped and stayed as dead code until the dual-
        // theme rebuild. Removed here to dedupe.

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
        "text-muted": "var(--clear-text-soft, #71717a)",
        "text-card": "#ffffff",
        "text-card-muted": "#a1a1aa",
      },

      fontFamily: {
        // 2026-05-08: editorial-sans rebuild. `font-display` now
        // resolves to Manrope (geometric warmth, distinctive cuts);
        // `font-sans` stays Geist for body. The pair gives
        // headlines real character without breaking the sans-only
        // money-app rule. Existing call sites need no change.
        // `font-numerals` is the new family for the financial
        // amount input on /send/* - JetBrains Mono with proper
        // tabular-numeric figures.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: [
          "var(--font-display)",
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
        numerals: [
          "var(--font-numerals)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },

      fontSize: {
        // Display scale - sans-tightened, capped at 2.5rem on desktop.
        // Old scale (Fraunces) climbed to 5rem, which read as magazine
        // hero, not money app. Geist at 2.5rem with weight 700 is the
        // Cash App / Apple Wallet register.
        "display-xs": ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.015em" }],
        "display-sm": ["2rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-md": ["2.25rem", { lineHeight: "1.08", letterSpacing: "-0.022em" }],
        "display-lg": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-xl": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],

        // Legacy hero-* - same cap. Retire over time.
        "hero-sm": ["2rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "hero-md": ["2.25rem", { lineHeight: "1.08", letterSpacing: "-0.022em" }],
        "hero-lg": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "hero-xl": ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
      },

      letterSpacing: {
        "ultra-tight": "-0.04em",
      },

      spacing: {
        // Touch sizing - Apple HIG min target is 44px; 56px for primary CTAs.
        tap: "44px",
        "tap-lg": "56px",
        // Page gutters - generous on mobile, more on desktop.
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
        // Friendly, banking-app feel - softer than the hard `rounded-md` default.
        soft: "10px",
        card: "16px",
        sheet: "24px",
      },

      transitionDuration: {
        fast: "150ms",
        base: "180ms",
        slow: "300ms",
      },

      transitionTimingFunction: {
        // `out-soft` → entrances, hover-lift; `in-out-soft` → state changes.
        "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)",
        "in-out-soft": "cubic-bezier(0.65, 0, 0.35, 1)",
      },

      boxShadow: {
        // ── Semantic ──────────────────────────────────────────────
        // Three-layer 3D treatment, theme-aware via CSS vars:
        //   1. inset top rim-light - light from above (white on dark,
        //      bright white on light for a soft glossy finish)
        //   2. inset bottom edge - gives the card visible "thickness"
        //      (40-50% black on dark; faint cool drop on light)
        //   3. layered drop shadows (close contact + soft far) - anchor
        //      the card to the surface and lift it ~12px on rest, ~24px
        //      raised. No colored hover ring; the depth change IS the
        //      hover signal. Light theme uses cool slate drops at much
        //      lower opacity so the card reads "lifted" without the
        //      heavy black halo that suits the obsidian canvas.
        "card-rest": "0 1px 2px var(--clear-card-shadow-close)",
        "card-raised": "0 10px 28px -12px var(--clear-card-shadow-far-raised)",
        "accent-rest": "0 4px 10px -4px var(--clear-accent-glow-rest)",
        "accent-hover": "0 6px 14px -6px var(--clear-accent-glow-hover)",

        // ── Legacy ────────────────────────────────────────────────
        glow: "0 10px 30px -10px rgba(204, 255, 0, 0.30)",
        "glow-hover": "0 20px 40px -10px rgba(204, 255, 0, 0.45)",
        "glow-strong": "0 0 60px -10px rgba(204, 255, 0, 0.35)",
        "card-shadow": "0 25px 50px -12px rgba(0, 0, 0, 0.45)",
        "card-dark": "0 20px 45px -15px rgba(0, 0, 0, 0.65)",
        "inner-glow": "inset 0 0 0 1px rgba(204, 255, 0, 0.18)",
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
          "radial-gradient(circle at 50% 0%, rgba(204, 255, 0,0.10), transparent 60%)",
        "hero-noise":
          "linear-gradient(135deg, rgba(204, 255, 0,0.06) 0%, rgba(16,185,129,0.04) 100%)",
        "skeleton-shimmer":
          "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%)",
      },

      screens: {
        // 360px-class phones - keeps tight layouts from stacking too early.
        xs: "420px",
      },
    },
  },
  plugins: [],
};

export default config;
