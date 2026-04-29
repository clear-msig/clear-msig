"use client";

// Workspace layout used by all connected-app pages.
//
// AppNav (the dedicated wallet/intents/proposals nav) was removed once
// intents and proposals collapsed into per-wallet tabs inside
// /app/wallet/[name]. With only one top-level destination (/app/wallet),
// dedicated nav chrome was just empty space; users navigate via the
// menu drawer in HeaderBar instead. Keeps the app minimalist.

import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { motion, useScroll, useTransform } from "framer-motion";

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  useWalletGate();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1000], [0, 300]);

  return (
    <main className="relative min-h-screen bg-background overflow-hidden px-3 pb-12 pt-24 sm:px-4 sm:pt-28 lg:px-6 font-sans">
      <motion.div
        style={{ y }}
        className="absolute top-0 right-[-10%] w-[60vw] h-[60vw] rounded-full bg-brand-green/10 blur-[150px] pointer-events-none"
      />

      <HeaderBar />

      <div className="relative z-10 mx-auto flex w-full max-w-[60rem] flex-col gap-6">
        <PreAlphaBanner />
        <section className="min-w-0 relative z-20">{children}</section>
      </div>
    </main>
  );
}
