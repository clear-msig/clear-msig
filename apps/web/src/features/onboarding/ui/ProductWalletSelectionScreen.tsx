"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { LandingAtmospherics } from "@/components/landing/LandingChrome";
import type { ProductWalletSelection } from "@/lib/hooks/useWalletGate";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";
import { productSurfaceById } from "@/lib/productSurfaces";
import {
  clearPendingProductSurface,
  saveSelectedProductSurface,
  saveSelectedProductWalletHref,
} from "@/lib/productSession";
import { toDisplayName } from "@/lib/retail/walletNames";

export function ProductWalletSelectionScreen({
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
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
