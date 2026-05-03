"use client";

// Connect — the dedicated wallet-selection page.
//
// Lifted out of the landing per the user request: the public landing
// no longer has a wallet-select button anywhere. CTAs that need a
// wallet (Get started, dashboard deep links, /welcome, /send) bounce
// here via `useWalletGate`, which appends a `?next=<original-path>`
// so we land them back where they meant to go after connecting.
//
// Visual direction: not "a centered text + button" — that read as
// half-finished. The connect screen is the user's *first* impression
// of the brand, so we lay out a small floating preview cluster (sample
// balance card, member avatars, a request-approved chip) behind the
// connect surface to communicate what they're about to see. Squads
// pulls the same trick with a blurred app preview behind their modal.

import { Suspense } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Usb,
} from "lucide-react";
import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { useLedger } from "@/lib/wallet/LedgerProvider";
import { useToast } from "@/components/ui/Toast";

export default function ConnectPageWrapper() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-canvas" aria-hidden="true" />}
    >
      <ConnectPage />
    </Suspense>
  );
}

function ConnectPage() {
  // The gate handles the post-connect redirect (?next or /app/wallet).
  // We just render the connect UI; the gate fires once `connected` flips.
  useWalletGate();
  const reduce = useReducedMotion();

  const fadeIn = (delay = 0, y = 12) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden bg-canvas">
      {/* Background — layered atmosphere instead of a single wash:
          1. Two soft accent blooms anchoring opposite corners.
          2. A faint dot-grid texture for depth (Tailwind's
             `bg-[radial-gradient]` with a tight stop). The opacity is
             low enough that it never competes with foreground content
             but the eye reads "made", not "default Tailwind page". */}
      {/* Background was a layered atmosphere (two accent blooms + a
          dot-grid) — fine on a marketing page, but /connect is the
          first time a user touches the actual product. The flat
          canvas matches Cash App / Apple Wallet / Squads. The card
          itself is the visual interest. */}

      <StickyTopBar>
        <Link
          href="/"
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Clear
        </Link>
      </StickyTopBar>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          {/* Left column — the brand argument. Bigger Fraunces hero,
              one trust line, and the floating preview cluster that
              communicates what's behind the wall. On mobile it stacks
              above the connect card. */}
          <motion.section {...fadeIn(0)} className="flex flex-col">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
              <Sparkles className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
              Shared wallets, signed by you
            </span>
            <h1 className="mt-5 font-display text-display-md leading-[0.95] text-text-strong text-balance lg:text-display-lg">
              Money you decide on,{" "}
              <span className="text-accent">together</span>.
            </h1>
            <p className="mt-4 max-w-md text-base text-text-soft">
              Send and approve from a wallet you share with people you
              trust. Partners, family, your team. Every move is signed
              by your own wallet; we never see your keys.
            </p>

            {/* Floating preview cluster — three small cards angled
                slightly, evoking "the dashboard you're about to see".
                Hidden on small screens to keep the connect card front
                and center. Pure decoration: pointer-events-none so
                they never intercept clicks. */}
            <div
              aria-hidden="true"
              className="pointer-events-none relative mt-10 hidden h-56 lg:block"
            >
              <PreviewCard
                className="absolute left-0 top-0 w-60 rotate-[-4deg]"
                kind="wallet"
                {...fadeIn(0.18, 16)}
              />
              <PreviewCard
                className="absolute left-32 top-16 w-56 rotate-[3deg]"
                kind="request"
                {...fadeIn(0.26, 16)}
              />
              <PreviewCard
                className="absolute left-4 top-32 w-52 rotate-[-2deg]"
                kind="members"
                {...fadeIn(0.34, 16)}
              />
            </div>
          </motion.section>

          {/* Right column — the connect surface. */}
          <motion.section
            {...fadeIn(0.08)}
            className="relative mx-auto w-full max-w-md"
          >
            <div className="rounded-card border border-border-soft bg-surface-raised p-7 shadow-card-raised sm:p-8">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
                <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />
              </div>
              <h2 className="font-display text-display-sm leading-[1.05] text-text-strong">
                Sign in or sign up
              </h2>
              <p className="mt-2 text-base text-text-soft">
                Use your email, your phone, or a wallet you already have.
                We will set the rest up for you.
              </p>

              {/* Replace the DynamicWidget's default outline CTA with
                  our own Button primary so it matches the rest of the
                  product (full-width, accent green, shadow-accent-rest).
                  setShowAuthFlow opens the same modal DynamicWidget
                  uses internally; we still mount <DynamicWidget /> in
                  a hidden node so the modal/portal stays wired up,
                  but the user-facing CTA is the Button below. */}
              <div className="mt-6">
                <ConnectCta />
                <div className="hidden">
                  <DynamicWidget />
                </div>
              </div>

              <p className="mt-5 text-xs leading-snug text-text-soft">
                Email and social sign-in mint a built-in wallet. You stay
                in control; we never see the keys.
              </p>

              <LedgerConnectRow />
            </div>

            {/* Trust strip — three brief lines justifying the ask.
                Stacked vertically below the connect card so they read
                as the immediate "why am I trusting this" answer
                without distracting from the primary action. */}
            <ul className="mt-5 flex flex-col gap-2 text-xs text-text-soft">
              <TrustItem icon={Lock} text="We never see your keys. Your wallet signs everything." />
              <TrustItem icon={ShieldCheck} text="Spending rules are encrypted on chain." />
              <TrustItem icon={Check} text="Open source. Every signature is auditable." />
            </ul>
          </motion.section>
        </div>
      </div>

      <footer className="relative z-10 flex items-center justify-center gap-4 px-gutter pb-6 text-xs text-text-soft">
        <Link
          href="/privacy"
          className="rounded-soft px-1.5 py-0.5 transition-colors duration-base ease-out-soft hover:text-text-strong"
        >
          How privacy works
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/"
          className="rounded-soft px-1.5 py-0.5 transition-colors duration-base ease-out-soft hover:text-text-strong"
        >
          What is Clear?
        </Link>
      </footer>
    </main>
  );
}

// ─── Brand-aligned Dynamic CTA ─────────────────────────────────────
//
// Dynamic's default CTA is a small white outline button that ignored
// our scoped CSS overrides (its inner button uses inline styles via
// emotion that win against arbitrary-variant Tailwind). Replacing it
// with our Button primitive that calls `setShowAuthFlow` opens the
// same modal — Dynamic doesn't care who opens it.

function ConnectCta() {
  const { setShowAuthFlow } = useDynamicContext();
  return (
    <Button
      size="lg"
      fullWidth
      onClick={() => setShowAuthFlow(true)}
    >
      Log in or sign up
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

// ─── Preview cluster cards ─────────────────────────────────────────

interface PreviewCardProps {
  className: string;
  kind: "wallet" | "request" | "members";
  initial?: { opacity: number; y: number };
  animate?: { opacity: number; y: number };
  transition?: { duration: number; delay: number; ease: readonly [number, number, number, number] };
}

function PreviewCard({ className, kind, ...motionProps }: PreviewCardProps) {
  const inner = (() => {
    if (kind === "wallet") {
      return (
        <>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-soft">
            Family
          </p>
          <p className="mt-1 font-display text-2xl text-text-strong">
            $4,820
          </p>
          <p className="mt-1 text-[10px] text-text-soft">
            Balance · 4 members
          </p>
        </>
      );
    }
    if (kind === "request") {
      return (
        <>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-accent">
            Approved
          </p>
          <p className="mt-1 text-sm font-medium text-text-strong">
            Send $120 to Sarah
          </p>
          <div className="mt-2 flex items-center gap-1">
            <span className="h-1.5 w-6 rounded-full bg-accent" />
            <span className="h-1.5 w-6 rounded-full bg-accent" />
            <span className="h-1.5 w-6 rounded-full bg-border-soft" />
            <span className="ml-1 text-[10px] text-text-soft">2/3</span>
          </div>
        </>
      );
    }
    return (
      <>
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-soft">
          Members
        </p>
        <div className="mt-2 flex -space-x-2">
          {["bg-accent", "bg-accent/70", "bg-text-soft/40", "bg-warning"].map(
            (bg, i) => (
              <span
                key={i}
                className={
                  "h-6 w-6 rounded-full ring-2 ring-surface-raised " + bg
                }
              />
            ),
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-text-soft">You + 3 friends</p>
      </>
    );
  })();
  return (
    <motion.div
      {...motionProps}
      className={
        "rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest " +
        className
      }
    >
      {inner}
    </motion.div>
  );
}

// ─── Ledger row ───────────────────────────────────────────────────
//
// Demoted to a small inline link below the email CTA. Old version
// rendered as a 52px button equal in weight to the primary CTA;
// users had to decide between two hero-level affordances at first
// paint. Squads moved off this exact pattern for the same reason.
// Hardware-wallet users still find it; retail users skip past.
// On success the wallet gate redirects; no extra navigation here.

function LedgerConnectRow() {
  const ledger = useLedger();
  const toast = useToast();
  const supportsHid =
    typeof window !== "undefined" && typeof navigator !== "undefined" && "hid" in navigator;

  const handleClick = async () => {
    try {
      await ledger.connect();
      toast.success("Ledger connected. Signing routes through your device now.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not connect Ledger",
      );
    }
  };

  // Already connected — keep the prominent success card; the user
  // needs to know their device is in the loop and how to back out.
  if (ledger.session) {
    return (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-card border border-accent/30 bg-accent/5 p-3 text-xs text-text-strong">
        <span className="inline-flex items-center gap-2">
          <Check className="h-4 w-4 text-accent" strokeWidth={2.25} />
          Ledger connected. Your device will show the full message when
          you sign.
        </span>
        <button
          type="button"
          onClick={() => ledger.disconnect()}
          className="rounded-soft px-2 py-1 text-[11px] text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // Browser without WebHID — silent. Retail users get nothing, power
  // users who do `navigator.hid` know what's missing. The previous
  // "Hardware wallets need WebHID" message was a teaching moment we
  // didn't need to surface at this height.
  if (!supportsHid) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={ledger.connecting}
        className={
          "inline-flex w-full items-center justify-center gap-1.5 rounded-soft px-2 py-1 text-xs text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
          "disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {ledger.connecting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Waiting for your Ledger
          </>
        ) : (
          <>
            <Usb className="h-3.5 w-3.5" aria-hidden="true" />
            Use a hardware wallet instead
          </>
        )}
      </button>
    </div>
  );
}

function TrustItem({ icon: Icon, text }: { icon: typeof Lock; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <Icon
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span>{text}</span>
    </li>
  );
}
