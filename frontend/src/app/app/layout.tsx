"use client";

// Workspace layout used by all connected-app pages.
//
// Visually mirrors the landing page: light outer bg (bg-background)
// with dark content cards rendered by each route. Decorative parallax
// blob + subtle gradient blurs (matching the landing hero) keep the
// surface feeling cinematic instead of form-y. Inside this shell every
// child page is expected to use bg-black / bg-surface cards with
// white text — same pattern as ProblemSection, BeforeAfterSection, and
// the chains showcase on the landing page.
//
// AppNav was removed when intents and proposals collapsed into per-
// wallet tabs inside /app/wallet/[name] — users navigate via the menu
// drawer in HeaderBar.

import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { HeaderBar } from "@/components/layout/HeaderBar";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { motion, useScroll, useTransform } from "framer-motion";

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  useWalletGate();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1000], [0, 300]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-3 pb-16 pt-24 font-sans sm:px-4 sm:pt-28 lg:px-6">
      {/* Two soft brand-coloured blurs — same visual vocabulary the
          landing page uses on its sections (ProblemSection, etc.) so
          the connected app feels like a natural continuation, not a
          different product. */}
      <motion.div
        aria-hidden="true"
        style={{ y }}
        className="pointer-events-none absolute -right-[10%] top-0 h-[60vw] w-[60vw] rounded-full bg-brand-green/15 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[10%] top-[40%] h-[40vw] w-[40vw] rounded-full bg-cyan-300/10 blur-[140px]"
      />

      <HeaderBar />

      <div className="relative z-10 mx-auto flex w-full max-w-[60rem] flex-col gap-6">
        <PreAlphaBanner />
        <section className="relative z-20 min-w-0">{children}</section>
      </div>
    </main>
  );
}
