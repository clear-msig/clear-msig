"use client";

// Connect - Obsidian & Lime rebuild (2026-05-08).
//
// The bridge between landing and /welcome. Lifted out of the landing
// per the user request: the public landing has no wallet-select button
// anywhere. CTAs that need a wallet (Get started, dashboard deep links,
// /welcome, /send) bounce here via `useWalletGate`, which appends a
// `?next=<original-path>` so we land them back where they meant to go
// after connecting.
//
// Visual layer matches the landing page (.landing-shell, glass cards,
// lime accents, Space Grotesk + JetBrains Mono typography). Behavior
// (Dynamic auth, Ledger WebHID, post-connect bridge state) is unchanged
// from the prior retail version.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Loader2,
  Lock,
  ShieldCheck,
  Usb,
} from "lucide-react";
import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";
import {
  useWalletGate,
  type ProductWalletSelection,
} from "@/lib/hooks/useWalletGate";
import { useWallet } from "@/lib/wallet";
import { useLedger } from "@/lib/wallet/LedgerProvider";
import { useLedgerPresence } from "@/lib/hooks/useLedgerPresence";
import { useToast } from "@/components/ui/Toast";
import {
  LandingAtmospherics,
  LandingNav,
} from "@/components/landing/LandingChrome";
import {
  isProductSurfaceId,
  productSurfaceById,
  type ProductSurface,
} from "@/lib/productSurfaces";
import {
  clearPendingProductSurface,
  rememberProductSurfaceChoice,
  saveSelectedProductSurface,
  saveSelectedProductWalletHref,
} from "@/lib/productSession";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function ConnectPageWrapper() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-black" aria-hidden="true" />}
    >
      <ConnectPage />
    </Suspense>
  );
}

function ConnectPage() {
  // The gate handles the post-connect redirect (?next or /app).
  // We just render the connect UI; the gate fires once `connected` flips.
  const gate = useWalletGate();
  const search = useSearchParams();
  const wallet = useWallet();
  const reduce = useReducedMotion();
  const selectedSurface =
    productSurfaceFromSearch(search.get("surface")) ??
    productSurfaceFromNext(search.get("next"));

  useEffect(() => {
    if (!selectedSurface) return;
    rememberProductSurfaceChoice(selectedSurface.id);
  }, [selectedSurface]);

  // Bridge state: Dynamic auth is done, wallet.connected is true, but
  // useWalletGate is still waiting for the memberships RPC to settle
  // before redirecting. Without an explicit "signed in, loading"
  // surface here, the user stares at the unchanged sign-in card for
  // 5-10s and assumes the click did nothing. Swap to a confident
  // success state.
  if (wallet.connected) {
    if (gate.productSelection) {
      return (
        <ProductWalletSelectionScreen
          selection={gate.productSelection}
          address={wallet.publicKey?.toBase58() ?? null}
          reduce={!!reduce}
        />
      );
    }
    return (
      <SignedInWaiting
        reduce={!!reduce}
        destination={connectDestinationFromNext(search.get("next"))}
      />
    );
  }

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
    // Bleed-to-edge shell - same flat structure as `/` and `/welcome`.
    // Atmospherics live in their own absolute overflow-hidden wrapper
    // so the fixed nav can layer above without being clipped.
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>
      <LandingNav cta={null} status="SIGN IN · DEVNET" />
      <main className="relative mx-auto w-full max-w-[1600px]">
        <div className="relative z-10 flex min-h-[calc(100vh-9rem)] items-center justify-center px-6 pb-16 pt-6 sm:min-h-[calc(100vh-12rem)] sm:px-10">
          <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
            {/* Left - brand argument */}
            <motion.section {...fadeIn(0)} className="flex flex-col">
              <div className="flex items-center">
                <span className="font-mono-tech text-[10px] uppercase tracking-[0.32em] text-white/60">
                  Shared wallets · signed by you
                </span>
              </div>

              <h1 className="landing-section-heading mt-6 text-[clamp(2.5rem,6.5vw,5rem)] font-light leading-[0.9] tracking-[-0.05em] text-white text-balance">
                {selectedSurface ? (
                  <>
                    Continue to
                    <br />
                    <span className="italic-skew">{selectedSurface.shortName}</span>.
                  </>
                ) : (
                  <>
                    Money you decide
                    <br />
                    on, <span className="italic-skew">together</span>.
                  </>
                )}
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-white/60 sm:text-lg">
                {selectedSurface
                  ? `Sign in once. After your wallet connects, we will take you straight to ${selectedSurface.name}.`
                  : "Send and approve from a wallet you share with people you trust. Partners, family, your team. Every move is signed by your own wallet; we never see your keys."}
              </p>

              {/* Floating preview cluster - pure decoration. */}
              <div
                aria-hidden="true"
                className="pointer-events-none relative mt-12 hidden h-60 lg:block"
              >
                <PreviewCard
                  className="float-slow absolute left-0 top-0 w-60 rotate-[-4deg]"
                  kind="wallet"
                  {...fadeIn(0.18, 16)}
                />
                <PreviewCard
                  className="float-slower absolute left-32 top-16 w-56 rotate-[3deg]"
                  kind="request"
                  {...fadeIn(0.26, 16)}
                />
                <PreviewCard
                  className="float-slow absolute left-4 top-36 w-52 rotate-[-2deg]"
                  kind="members"
                  {...fadeIn(0.34, 16)}
                />
              </div>
            </motion.section>

            {/* Right - connect surface */}
            <motion.section
              {...fadeIn(0.08)}
              className="relative mx-auto w-full max-w-md"
            >
              <div className="glass relative overflow-hidden rounded-[2rem] p-7 sm:p-8">
                {/* Inner lime glow accent */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full opacity-50"
                  style={{
                    background:
                      "radial-gradient(circle at center, rgba(204, 255, 0,0.18) 0%, rgba(204, 255, 0,0) 70%)",
                    filter: "blur(40px)",
                  }}
                />

                <div className="relative flex flex-col items-center text-center">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ccff00]/10 text-[#ccff00] ring-1 ring-[#ccff00]/30 shadow-[0_0_24px_rgba(204, 255, 0,0.15)]">
                    <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />
                  </div>
                  <h2 className="landing-section-heading mt-3 text-[clamp(1.75rem,3.5vw,2.5rem)] font-light leading-[1] tracking-[-0.03em] text-white">
                    {selectedSurface ? (
                      <>
                        Sign in for{" "}
                        <span className="italic-skew">{selectedSurface.shortName}</span>.
                      </>
                    ) : (
                      <>
                        Sign in <span className="italic-skew">or</span> sign up.
                      </>
                    )}
                  </h2>
                  <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-white/60">
                    {selectedSurface
                      ? selectedSurface.summary
                      : "Use your email, your phone, or a wallet you already have. We will set the rest up for you."}
                  </p>

                  {/* Replace Dynamic's default outline CTA with a
                      neon-cta primary so it matches the rest of the
                      brand. setShowAuthFlow opens the same modal
                      DynamicWidget uses internally; we still mount
                      <DynamicWidget /> hidden so the modal/portal
                      stays wired up. */}
                  <div className="mt-7 w-full">
                    <ConnectCta />
                    <div className="hidden">
                      <DynamicWidget />
                    </div>
                  </div>

                  <div className="w-full">
                    <LedgerConnectRow />
                  </div>
                </div>
              </div>

              {/* Trust strip */}
              <ul className="mt-6 flex flex-col gap-2 text-[13px] text-white/60">
                <TrustItem
                  icon={Lock}
                  text="We never see your keys. Your wallet signs everything."
                />
                <TrustItem
                  icon={ShieldCheck}
                  text="Spending rules are Encrypt-ready for the pre-alpha."
                />
                <TrustItem
                  icon={Check}
                  text="Open source. Every signature is auditable."
                />
              </ul>
            </motion.section>
          </div>
        </div>

        <footer className="relative z-10 flex items-center justify-center gap-4 border-t border-border-soft px-6 py-6 sm:px-10">
          <Link
            href="/privacy"
            className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/50 transition-colors duration-200 hover:text-[#ccff00]"
          >
            How privacy works
          </Link>
          <span aria-hidden="true" className="text-white/20">
            ·
          </span>
          <Link
            href="/"
            className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/50 transition-colors duration-200 hover:text-[#ccff00]"
          >
            What is Clear?
          </Link>
        </footer>
      </main>
    </div>
  );
}

function productSurfaceFromSearch(surface: string | null): ProductSurface | null {
  return isProductSurfaceId(surface) ? productSurfaceById(surface) : null;
}

function productSurfaceFromNext(next: string | null): ProductSurface | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  try {
    const url = new URL(next, "https://clearsig.local");
    const surface = url.searchParams.get("surface");
    return isProductSurfaceId(surface) ? productSurfaceById(surface) : null;
  } catch {
    return null;
  }
}

function connectDestinationFromNext(
  next: string | null,
): "wallet" | "secure" | "app" | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  try {
    const url = new URL(next, "https://clearsig.local");
    if (url.pathname.startsWith("/app/wallet/")) return "wallet";
    if (url.pathname.startsWith("/app/secure")) return "secure";
    if (url.pathname.startsWith("/app")) return "app";
    return null;
  } catch {
    return null;
  }
}

// ─── Brand-aligned Dynamic CTA ─────────────────────────────────────
//
// Dynamic's default CTA is a small white outline button that ignored
// our scoped CSS overrides. Replacing it with a neon-cta button that
// calls `setShowAuthFlow` opens the same modal - Dynamic doesn't care
// who opens it.

function ConnectCta() {
  const { setShowAuthFlow } = useDynamicContext();
  return (
    <button
      type="button"
      onClick={() => setShowAuthFlow(true)}
      className="neon-cta inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight"
    >
      Continue
      <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

// ─── Signed-in bridge state ────────────────────────────────────────
//
// Dynamic auth completed, wallet.connected is true, but the wallet
// gate is still fetching memberships before deciding whether to send
// the user to /app (returning) or /welcome (first-timer). That
// fetch can take 5-10s on devnet. Render a dedicated "we got you"
// state so the user knows the click worked.

function SignedInWaiting({
  reduce,
  destination,
}: {
  reduce: boolean;
  destination: "wallet" | "secure" | "app" | null;
}) {
  const MotionCheck = motion(Check);
  const copy =
    destination === "wallet"
      ? {
          body: "Opening the wallet you selected.",
          label: "Opening wallet",
        }
      : destination === "secure"
        ? {
            body: "Opening your recovery workspace.",
            label: "Opening secure",
          }
        : destination === "app"
          ? {
              body: "Opening your ClearSig workspace.",
              label: "Opening app",
            }
          : {
              body: "Loading your shared wallets. This usually takes a few seconds on devnet.",
              label: "Loading wallets",
            };

  return (
    // Flat landing-shell with NO nav. Wallets are loading - the user
    // can't act on anything else, so the chrome would just be noise
    // around the loading state. Bringing the loading content to the
    // front of the user's attention is the whole point of this view.
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>
      <main className="relative mx-auto w-full max-w-[1600px]">
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] as const }}
            className="flex w-full max-w-sm flex-col items-center text-center"
          >
            <motion.div
              initial={reduce ? false : { scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                damping: 18,
                stiffness: 220,
                delay: 0.05,
              }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ccff00] text-black shadow-[0_0_40px_rgba(204, 255, 0,0.5)]"
            >
              <MotionCheck
                className="h-8 w-8"
                strokeWidth={2.5}
                aria-hidden="true"
                initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.45, ease: "easeOut", delay: 0.18 }}
              />
            </motion.div>

            <div className="mt-6 flex items-center gap-2">
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-white/60">
                session ready
              </span>
            </div>
            <h1 className="landing-section-heading mt-3 text-[clamp(2rem,5vw,3rem)] font-light leading-[0.95] tracking-[-0.04em] text-white">
              You&rsquo;re <span className="italic-skew">in</span>.
            </h1>
            <p className="mt-3 text-base leading-relaxed text-white/60">
              {copy.body}
            </p>
            <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-border-soft bg-glass-soft px-4 py-2 backdrop-blur-md">
              <Loader2
                className="h-3.5 w-3.5 animate-spin text-[#ccff00]"
                aria-hidden="true"
              />
              <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/70">
                {copy.label}
              </span>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

function ProductWalletSelectionScreen({
  selection,
  address,
  reduce,
}: {
  selection: ProductWalletSelection;
  address: string | null;
  reduce: boolean;
}) {
  const router = useRouter();
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const surface = productSurfaceById(selection.surface);
  const Icon = PRODUCT_SURFACE_ICON[selection.surface];

  const handleSelect = (walletName: string, href: string) => {
    if (selectedWallet) return;
    setSelectedWallet(walletName);
    saveSelectedProductSurface(selection.surface, address);
    saveSelectedProductWalletHref(selection.surface, href, address);
    clearPendingProductSurface();
    router.replace(href);
  };

  return (
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>
      <main className="relative mx-auto w-full max-w-[1600px]">
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
          <motion.section
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] as const }}
            className="w-full max-w-xl rounded-[2rem] border border-border-soft bg-[#101111]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7"
          >
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ccff00] text-black shadow-[0_0_28px_rgba(204,255,0,0.28)]">
                <Icon className="h-6 w-6" strokeWidth={2.25} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-mono-tech text-[10px] uppercase tracking-[0.28em] text-[#ccff00]">
                  {surface.shortName} wallets
                </p>
                <h1 className="landing-section-heading mt-2 text-[clamp(2rem,5vw,3rem)] font-light leading-[0.95] tracking-[-0.04em] text-white">
                  Choose one to continue.
                </h1>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60 sm:text-base">
                  You have more than one {surface.shortName.toLowerCase()} wallet.
                  Pick the workspace you want to open.
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-3">
              {selection.wallets.map((wallet) => {
                const loading = selectedWallet === wallet.walletName;
                return (
                  <button
                    key={wallet.walletName}
                    type="button"
                    onClick={() => handleSelect(wallet.walletName, wallet.href)}
                    disabled={selectedWallet !== null}
                    className="group flex min-h-[4.5rem] w-full items-center justify-between gap-4 rounded-2xl bg-white/[0.055] px-4 py-3 text-left transition-[background-color,transform,opacity] duration-200 hover:-translate-y-0.5 hover:bg-white/[0.085] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/70 disabled:cursor-wait disabled:opacity-70"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/40 text-[#ccff00]">
                        <Icon className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-white">
                          {toDisplayName(wallet.walletName)}
                        </span>
                        <span className="mt-1 block font-mono-tech text-[10px] uppercase tracking-[0.22em] text-white/45">
                          {surface.shortName}
                        </span>
                      </span>
                    </span>
                    {loading ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-[#ccff00]"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-white/55 transition-transform group-hover:translate-x-0.5 group-hover:text-[#ccff00]"
                        strokeWidth={2.4}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.section>
        </div>
      </main>
    </div>
  );
}

// ─── Preview cluster cards ─────────────────────────────────────────

interface PreviewCardProps {
  className: string;
  kind: "wallet" | "request" | "members";
  initial?: { opacity: number; y: number };
  animate?: { opacity: number; y: number };
  transition?: {
    duration: number;
    delay: number;
    ease: readonly [number, number, number, number];
  };
}

function PreviewCard({ className, kind, ...motionProps }: PreviewCardProps) {
  const inner = (() => {
    if (kind === "wallet") {
      return (
        <>
          <p className="font-mono-tech text-[9px] uppercase tracking-[0.28em] text-white/50">
            Family
          </p>
          <p className="mt-1 text-2xl font-light tracking-tight text-white">
            $4,820
          </p>
          <p className="mt-1 font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
            Balance · 4 members
          </p>
        </>
      );
    }
    if (kind === "request") {
      return (
        <>
          <div className="flex items-center">
            <p className="font-mono-tech text-[9px] uppercase tracking-[0.28em] text-[#ccff00]">
              Approved
            </p>
          </div>
          <p className="mt-1.5 text-sm font-medium text-white">
            Send $120 to Sarah
          </p>
          <div className="mt-2 flex items-center gap-1">
            <span className="h-1.5 w-6 rounded-full bg-[#ccff00]" />
            <span className="h-1.5 w-6 rounded-full bg-[#ccff00]" />
            <span className="h-1.5 w-6 rounded-full bg-white/15" />
            <span className="ml-1 font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/50">
              2/3
            </span>
          </div>
        </>
      );
    }
    return (
      <>
        <p className="font-mono-tech text-[9px] uppercase tracking-[0.28em] text-white/50">
          Members
        </p>
        <div className="mt-2 flex -space-x-2">
          {[
            "bg-[#ccff00]",
            "bg-[#ccff00]/70",
            "bg-white/30",
            "bg-[#10b981]",
          ].map((bg, i) => (
            <span
              key={i}
              className={"h-6 w-6 rounded-full ring-2 ring-[#0c0c0c] " + bg}
            />
          ))}
        </div>
        <p className="mt-2 font-mono-tech text-[9px] uppercase tracking-[0.24em] text-white/40">
          You + 3 friends
        </p>
      </>
    );
  })();
  return (
    <motion.div
      {...motionProps}
      className={"glass rounded-2xl p-3.5 " + className}
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

function LedgerConnectRow() {
  const ledger = useLedger();
  const toast = useToast();
  const presence = useLedgerPresence();
  const supportsHid = presence.supported;

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

  // Already connected - keep the prominent success card.
  if (ledger.session) {
    return (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[#ccff00]/40 bg-[#ccff00]/[0.06] p-3 text-xs text-white backdrop-blur-md">
        <span className="inline-flex items-center gap-2">
          <Check
            className="h-4 w-4 text-[#ccff00]"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <span className="text-[12px] leading-snug">
            Ledger connected. Your device will show the full message
            when you sign.
          </span>
        </span>
        <button
          type="button"
          onClick={() => ledger.disconnect()}
          className="rounded-full px-2.5 py-1 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // Browser without WebHID - silent.
  if (!supportsHid) return null;

  // Auto-detected a previously-paired Ledger via WebHID.
  if (presence.detected) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={ledger.connecting}
        className="mt-5 flex w-full items-center justify-between gap-3 rounded-2xl border border-[#ccff00]/40 bg-[#ccff00]/[0.06] p-3 text-left text-xs backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[#ccff00] hover:bg-[#ccff00]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="inline-flex items-center gap-2">
          <Usb
            className="h-4 w-4 text-[#ccff00]"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-white">
              Ledger detected
            </span>
            <span className="font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/50">
              Sign with your hardware wallet
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#ccff00] px-3 py-1 text-[11px] font-bold text-black shadow-[0_0_18px_rgba(204, 255, 0,0.35)]">
          {ledger.connecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Connecting…
            </>
          ) : (
            "Connect"
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={handleClick}
        disabled={ledger.connecting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border-strong bg-glass-soft px-4 py-2.5 font-mono-tech text-[10px] uppercase tracking-[0.24em] text-white/60 backdrop-blur-md transition-[color,background-color,border-color] duration-200 hover:border-[#ccff00]/50 hover:bg-[#ccff00]/[0.08] hover:text-[#ccff00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]/50 disabled:cursor-not-allowed disabled:opacity-60"
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
    <li className="flex items-start gap-2.5">
      <Icon
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ccff00]"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="leading-relaxed">{text}</span>
    </li>
  );
}
