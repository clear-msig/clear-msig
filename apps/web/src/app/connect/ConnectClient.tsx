"use client";

// Shared public presentation; provider hydration and destination handling stay local.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { ArrowRight, Check, Lock, ShieldCheck } from "lucide-react";
import {
  LandingAtmospherics,
  LandingNav,
} from "@/components/landing/LandingChrome";
import {
  isProductSurfaceId,
  productSurfaceById,
  type ProductSurface,
} from "@/lib/productSurfaces";
import { rememberProductSurfaceChoice } from "@/lib/productSession";

const ConnectRuntimeIsland = dynamic(() => import("./ConnectRuntimeIsland"), {
  ssr: false,
  loading: () => null,
});

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
  const search = useSearchParams();
  const reduce = useReducedMotion();
  const [authRequested, setAuthRequested] = useState(false);
  const [hydrateAuthRuntime, setHydrateAuthRuntime] = useState(false);
  const selectedSurface =
    productSurfaceFromSearch(search.get("surface")) ??
    productSurfaceFromNext(search.get("next"));
  const destination = connectDestinationFromNext(search.get("next"));

  useEffect(() => {
    if (!selectedSurface) return;
    rememberProductSurfaceChoice(selectedSurface.id);
  }, [selectedSurface]);

  useEffect(() => {
    if (authRequested || hydrateAuthRuntime) return;
    const hydrate = () => setHydrateAuthRuntime(true);
    const idleHandle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(hydrate, { timeout: 1600 })
        : null;
    const timeoutHandle = window.setTimeout(hydrate, 2200);
    return () => {
      window.clearTimeout(timeoutHandle);
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, [authRequested, hydrateAuthRuntime]);

  const fadeIn = (delay = 0, _y = 12) =>
    reduce
      ? {
          initial: false as const,
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0 },
        }
      : {
          initial: false as const,
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
    <div className="public-brand-surface landing-shell brand-entry relative min-h-screen bg-canvas text-text-strong">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <LandingAtmospherics />
      </div>
      <LandingNav cta={null} status="SIGN IN · DEVNET" />
      <main className="relative mx-auto w-full max-w-[1600px]">
        <div className="relative z-10 flex min-h-[calc(100vh-9rem)] items-center justify-center px-6 pb-16 pt-6 sm:min-h-[calc(100vh-12rem)] sm:px-10">
          <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
            {/* Left - brand argument */}
            <motion.section {...fadeIn(0)} className="flex flex-col">
              <div className="flex items-center">
                <span className="font-mono-tech text-xs uppercase tracking-[0.32em] text-text-soft">
                  Shared wallets · signed by you
                </span>
              </div>

              <h1 className="landing-section-heading mt-6 text-[clamp(2.5rem,6.5vw,5rem)] font-light leading-[0.9] tracking-[-0.05em] text-text-strong text-balance">
                {selectedSurface ? (
                  <>
                    Continue to
                    <br />
                    <span className="italic-skew">
                      {selectedSurface.shortName}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    Money you decide
                    <br />
                    on, <span className="italic-skew">together</span>.
                  </>
                )}
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-text-soft sm:text-lg">
                {selectedSurface
                  ? `Sign in once. After your wallet connects, we will take you straight to ${selectedSurface.name}.`
                  : "Send and approve from a wallet you share with people you trust. Partners, family, your team. Every move is signed by your own wallet; we never see your keys."}
              </p>

              <div className="entry-document" aria-label="How shared approvals work">
                <p className="entry-document-label">One shared decision</p>
                <ol>
                  <li><span>01</span><div><strong>Request</strong><p>See what you are being asked to sign.</p></div></li>
                  <li><span>02</span><div><strong>Rules</strong><p>Review the wallet’s approval requirements.</p></div></li>
                  <li><span>03</span><div><strong>Owners</strong><p>Each person signs with their own wallet.</p></div></li>
                </ol>
              </div>
            </motion.section>

            {/* Right - connect surface */}
            <motion.section
              {...fadeIn(0.08)}
              className="relative mx-auto w-full max-w-md"
            >
              <div className="entry-auth-panel relative border border-border-soft bg-surface-raised p-7 sm:p-8">
                <div className="relative flex flex-col items-center text-center">
                  <div className="entry-auth-icon mb-5 inline-flex h-14 w-14 items-center justify-center text-accent">
                    <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />
                  </div>
                  <h2 className="landing-section-heading mt-3 text-[clamp(1.75rem,3.5vw,2.5rem)] font-light leading-[1] tracking-[-0.03em] text-text-strong">
                    {selectedSurface ? (
                      <>
                        Sign in for{" "}
                        <span className="italic-skew">
                          {selectedSurface.shortName}
                        </span>
                        .
                      </>
                    ) : (
                      <>
                        Sign in <span className="italic-skew">or</span> sign up.
                      </>
                    )}
                  </h2>
                  <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-text-soft">
                    {selectedSurface
                      ? selectedSurface.summary
                      : "Choose from the sign-in methods available in the next step, or connect a supported wallet."}
                  </p>

                  <div className="mt-7 w-full">
                    {authRequested || hydrateAuthRuntime ? (
                      <ConnectRuntimeIsland
                        environmentId={
                          process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? ""
                        }
                        autoOpen={authRequested}
                        reduce={!!reduce}
                        destination={destination}
                      />
                    ) : (
                      <FastConnectCta
                        onClick={() => {
                          setAuthRequested(true);
                          setHydrateAuthRuntime(true);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Trust strip */}
              <ul className="mt-6 flex flex-col gap-2 text-[13px] text-text-soft">
                <TrustItem
                  icon={Lock}
                  text="We never see your keys. Your wallet signs everything."
                />
                <TrustItem
                  icon={ShieldCheck}
                  text="Review supported rules and preview limitations before signing."
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
            className="font-mono-tech text-xs uppercase tracking-[0.24em] text-text-soft transition-colors duration-200 hover:text-accent"
          >
            How privacy works
          </Link>
          <span aria-hidden="true" className="text-text-soft">
            ·
          </span>
          <Link
            href="/"
            className="font-mono-tech text-xs uppercase tracking-[0.24em] text-text-soft transition-colors duration-200 hover:text-accent"
          >
            What is Clear?
          </Link>
        </footer>
      </main>
    </div>
  );
}

function productSurfaceFromSearch(
  surface: string | null,
): ProductSurface | null {
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

function FastConnectCta({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="neon-cta inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight"
    >
      Continue
      <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

function TrustItem({ icon: Icon, text }: { icon: typeof Lock; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="leading-relaxed">{text}</span>
    </li>
  );
}
