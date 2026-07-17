"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import ConnectDynamicProviderTree from "@/features/wallet-runtime/infrastructure/ConnectDynamicProviderTree";
import { ProductWalletSelectionScreen } from "@/features/onboarding/ui/ProductWalletSelectionScreen";
import { LedgerConnectRow } from "@/features/onboarding/ui/LedgerConnectRow";
import { LandingAtmospherics } from "@/components/landing/LandingChrome";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useWallet } from "@/lib/wallet";

type ConnectDestination = "wallet" | "secure" | "app" | null;

export default function ConnectRuntimeIsland({
  environmentId,
  autoOpen,
  reduce,
  destination,
}: {
  environmentId: string;
  autoOpen: boolean;
  reduce: boolean;
  destination: ConnectDestination;
}) {
  if (!environmentId) {
    return (
      <button
        type="button"
        disabled
        className="neon-cta inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight opacity-60"
      >
        Sign in unavailable
      </button>
    );
  }

  return (
    <ConnectDynamicProviderTree environmentId={environmentId}>
      <ConnectRuntimeContent
        autoOpen={autoOpen}
        reduce={reduce}
        destination={destination}
      />
    </ConnectDynamicProviderTree>
  );
}

function ConnectRuntimeContent({
  autoOpen,
  reduce,
  destination,
}: {
  autoOpen: boolean;
  reduce: boolean;
  destination: ConnectDestination;
}) {
  const { sdkHasLoaded, setShowAuthFlow } = useDynamicContext();
  const gate = useWalletGate();
  const wallet = useWallet();
  const openedAuthFlow = useRef(false);

  useEffect(() => {
    if (!autoOpen || openedAuthFlow.current || wallet.connected) return;
    if (!sdkHasLoaded) return;
    openedAuthFlow.current = true;
    setShowAuthFlow(true);
  }, [autoOpen, sdkHasLoaded, setShowAuthFlow, wallet.connected]);

  if (wallet.connected) {
    if (gate.productSelection) {
      return (
        <div className="fixed inset-0 z-[100] bg-[#0c0c0c]">
          <ProductWalletSelectionScreen
            selection={gate.productSelection}
            address={wallet.publicKey?.toBase58() ?? null}
            reduce={reduce}
          />
        </div>
      );
    }
    return (
      <SignedInWaiting reduce={reduce} destination={destination} />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          openedAuthFlow.current = true;
          setShowAuthFlow(true);
        }}
        disabled={!sdkHasLoaded}
        className="neon-cta inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-4 text-[14px] font-bold tracking-tight disabled:cursor-wait disabled:opacity-70"
      >
        {sdkHasLoaded ? "Continue" : "Preparing sign in"}
        {sdkHasLoaded ? (
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} aria-hidden="true" />
        )}
      </button>
      <div className="w-full">
        <LedgerConnectRow />
      </div>
    </>
  );
}

function SignedInWaiting({
  reduce,
  destination,
}: {
  reduce: boolean;
  destination: ConnectDestination;
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
    <div className="landing-shell fixed inset-0 z-[100] bg-[#0c0c0c] text-[#ebebeb]">
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
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ccff00] text-black shadow-[0_0_40px_rgba(204,255,0,0.5)]"
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
